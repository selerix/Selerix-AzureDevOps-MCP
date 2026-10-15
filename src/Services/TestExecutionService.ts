import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IReleaseApi } from "azure-devops-node-api/ReleaseApi";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { BuildQueryOrder, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces";
import { EnvironmentStatus } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
import * as fs from "fs";
import * as path from "path";
import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import {
  GetTestCaseExecutionHistoryParams,
  GetTestRunsParams,
  LinkTestRunToWorkItemsParams,
} from "../Interfaces/TestExecution";
import {
  PointUpdateModel,
  ResultDetails,
  TestRun,
  TestActionResultModel,
  TestAttachmentRequestModel,
} from "azure-devops-node-api/interfaces/TestInterfaces";
import {
  AddTestResultAttachmentParams,
  AddTestResultCommentParams,
  AddTestRunAttachmentParams,
  AssignTesterParams,
  AttachmentContentParams,
  ResetTestToActiveParams,
  TestAttachmentKind,
  TestPointSelection,
  UpdateTestResultAnalysisParams,
  CompleteTestRunParams,
  GetReleaseDefinitionDetailsParams,
  GetTestResultParams,
  ListReleaseDefinitionsParams,
  SetTestResultOutcomeParams,
  SetTestStepResultsParams,
  ParsedTestStep,
  ResolvedTestPoint,
  StartedTestResult,
  StartTestRunParams,
} from "../Interfaces/TestExecution";

// The test attachment API takes the file as a base64 string inside a JSON body.
const MAX_TEST_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];
const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".wmv"];

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};

/** Decode the (possibly double-encoded) HTML ADO stores in step text down to plain text. */
function htmlToText(value: string): string {
  let text = value;
  // Step text is XML-escaped HTML, so one pass of decoding yields tags, a second yields text.
  for (let pass = 0; pass < 2; pass++) {
    text = text.replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (m) => HTML_ENTITIES[m] ?? m);
    if (pass === 0) {
      text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p)>/gi, "\n").replace(/<[^>]+>/g, "");
    }
  }
  return text.replace(/\n{2,}/g, "\n").trim();
}

/**
 * Parse the Microsoft.VSTS.TCM.Steps XML of a test case into steps. Shared-step references
 * (<compref>) are not expanded - their ids are skipped, so recording results against steps
 * inside a shared step set is not supported.
 */
export function parseTestSteps(stepsXml: string | undefined): ParsedTestStep[] {
  if (!stepsXml) {
    return [];
  }
  const steps: ParsedTestStep[] = [];
  const stepRegex = /<step\s+id="(\d+)"\s+type="(ActionStep|ValidateStep)"[^>]*>([\s\S]*?)<\/step>/g;
  let match: RegExpExecArray | null;
  while ((match = stepRegex.exec(stepsXml)) !== null) {
    const strings = [...match[3].matchAll(/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map((m) => m[1]);
    const id = parseInt(match[1], 10);
    steps.push({
      id,
      actionPath: id.toString(16).toUpperCase().padStart(8, "0"),
      type: match[2] as ParsedTestStep["type"],
      action: htmlToText(strings[0] ?? ""),
      expectedResult: htmlToText(strings[1] ?? ""),
    });
  }
  return steps;
}

export class TestExecutionService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  protected async getTestApi(): Promise<ITestApi> {
    return await this.connection.getTestApi();
  }

  protected async getTestPlanApi(): Promise<ITestPlanApi> {
    return await this.connection.getTestPlanApi();
  }

  protected async getReleaseApi(): Promise<IReleaseApi> {
    return await this.connection.getReleaseApi();
  }

  protected async getBuildApi(): Promise<IBuildApi> {
    return await this.connection.getBuildApi();
  }

  /**
   * Resolve the test points (test case + configuration pairs) in a plan for the given test
   * cases. When suiteId is omitted each test case's suites are looked up and filtered to the
   * plan. A test case with several configurations yields one point per configuration.
   */
  protected async resolveTestPoints(
    planId: number,
    testCaseIds: number[],
    suiteId?: number
  ): Promise<{ points: ResolvedTestPoint[]; unresolvedTestCaseIds: number[] }> {
    const testPlanApi = await this.getTestPlanApi();

    // suite id -> test cases to look for in that suite
    const bySuite = new Map<number, number[]>();
    if (suiteId !== undefined) {
      bySuite.set(suiteId, [...testCaseIds]);
    } else {
      for (const testCaseId of testCaseIds) {
        const suites = await testPlanApi.getSuitesByTestCaseId(testCaseId);
        for (const suite of suites || []) {
          if (suite.plan?.id === planId && suite.id !== undefined) {
            bySuite.set(suite.id, [...(bySuite.get(suite.id) || []), testCaseId]);
          }
        }
      }
    }

    const points = new Map<number, ResolvedTestPoint>();
    for (const [suite, caseIds] of bySuite) {
      const suitePoints = await testPlanApi.getPointsList(
        this.config.project,
        planId,
        suite,
        undefined,
        caseIds.join(","),
        undefined,
        undefined,
        false,
        false
      );
      for (const point of suitePoints || []) {
        const testCaseId = point.testCaseReference?.id;
        if (point.id !== undefined && testCaseId !== undefined) {
          points.set(point.id, { pointId: point.id, testCaseId, suiteId: suite, planId });
        }
      }
    }

    const resolvedCases = new Set([...points.values()].map((p) => p.testCaseId));
    return {
      points: [...points.values()],
      unresolvedTestCaseIds: testCaseIds.filter((id) => !resolvedCases.has(id)),
    };
  }

  public async listReleaseDefinitions(params: ListReleaseDefinitionsParams) {
    try {
      const releaseApi = await this.getReleaseApi();
      const definitions = await releaseApi.getReleaseDefinitions(
        this.config.project,
        params.searchText,
        undefined,
        undefined,
        undefined,
        params.top
      );
      return (definitions || []).map((d) => ({ id: d.id, name: d.name, path: d.path }));
    } catch (error) {
      console.error("Error listing release definitions:", error);
      throw error;
    }
  }

  public async getReleaseDefinitionDetails(params: GetReleaseDefinitionDetailsParams) {
    try {
      const releaseApi = await this.getReleaseApi();
      const definition = await releaseApi.getReleaseDefinition(this.config.project, params.releaseDefinitionId);
      return {
        id: definition.id,
        name: definition.name,
        stages: (definition.environments || []).map((e) => ({ id: e.id, name: e.name, rank: e.rank })),
        artifacts: (definition.artifacts || []).map((a) => ({
          alias: a.alias,
          type: a.type,
          isPrimary: a.isPrimary,
          buildPipelineId: a.type === "Build" ? Number(a.definitionReference?.definition?.id) || undefined : undefined,
          buildPipelineName: a.definitionReference?.definition?.name,
        })),
      };
    } catch (error) {
      console.error(`Error getting release definition ${params.releaseDefinitionId}:`, error);
      throw error;
    }
  }

  /** Resolve a build id from an explicit id, a build number, or the latest completed build. */
  protected async resolveBuild(pipelineId: number, buildId?: number, buildNumber?: string) {
    const buildApi = await this.getBuildApi();
    if (buildId !== undefined) {
      return await buildApi.getBuild(this.config.project, buildId);
    }
    const builds = await buildApi.getBuilds(
      this.config.project, [pipelineId], undefined, buildNumber, undefined, undefined, undefined, undefined,
      buildNumber ? undefined : BuildStatus.Completed, undefined, undefined, undefined, 1, undefined, undefined,
      undefined, BuildQueryOrder.FinishTimeDescending
    );
    if (!builds || builds.length === 0) {
      throw new Error(
        buildNumber
          ? `Build number ${buildNumber} not found for pipeline ${pipelineId}`
          : `No completed builds found for pipeline ${pipelineId}`
      );
    }
    return builds[0];
  }

  /**
   * Start a test run for one or more test cases.
   *  - manual + webApplication: creates an in-progress run whose results the caller then records.
   *  - automated + releaseStage: creates the run, creates a release from the chosen build with
   *    every stage set to manual, then deploys only the chosen stage.
   */
  public async startTestRun(params: StartTestRunParams) {
    try {
      if (!params.testCaseIds || params.testCaseIds.length === 0) {
        throw new Error("testCaseIds must contain at least one test case id");
      }
      if (params.testType === "manual" && params.runner !== "webApplication") {
        throw new Error("Manual test runs use the 'webApplication' runner");
      }
      if (params.testType === "automated") {
        if (params.runner !== "releaseStage") {
          throw new Error("Automated test runs use the 'releaseStage' runner");
        }
        const missing = (["buildPipelineId", "releasePipelineId", "stageName"] as const).filter((k) => params[k] === undefined);
        if (missing.length > 0) {
          throw new Error(`Automated runs require: ${missing.join(", ")}`);
        }
      }

      const { points, unresolvedTestCaseIds } = await this.resolveTestPoints(params.planId, params.testCaseIds, params.suiteId);
      if (points.length === 0) {
        throw new Error(`No test points found in plan ${params.planId} for test cases ${params.testCaseIds.join(", ")}`);
      }

      const testApi = await this.getTestApi();
      const runName = params.runName || `Run of ${params.testCaseIds.length} test case(s) - ${new Date().toISOString()}`;
      const automated = params.testType === "automated";
      const run = await testApi.createTestRun(
        {
          name: runName,
          plan: { id: String(params.planId) },
          pointIds: points.map((p) => p.pointId),
          automated,
          state: automated ? "NotStarted" : "InProgress",
          configurationIds: [],
        },
        this.config.project
      );

      let release: { id?: number; name?: string; stage: string } | undefined;
      if (automated) {
        release = await this.deployStage(run.id!, params);
      }

      const results = automated ? [] : await testApi.getTestResults(this.config.project, run.id!);
      const pointByCase = new Map(points.map((p) => [p.testCaseId, p.pointId]));
      return {
        runId: run.id,
        runName: run.name,
        runUrl: run.webAccessUrl,
        state: run.state,
        unresolvedTestCaseIds,
        release,
        results: results.map((r) => ({
          resultId: r.id!,
          testCaseId: r.testCase?.id !== undefined ? Number(r.testCase.id) : undefined,
          pointId: pointByCase.get(Number(r.testCase?.id)),
          outcome: r.outcome,
          state: r.state,
        })) as StartedTestResult[],
      };
    } catch (error) {
      console.error("Error starting test run:", error);
      throw error;
    }
  }

  private async deployStage(runId: number, params: StartTestRunParams) {
    const releaseApi = await this.getReleaseApi();
    const definition = await releaseApi.getReleaseDefinition(this.config.project, params.releasePipelineId!);
    const environments = definition.environments || [];
    const stage = environments.find((e) => e.name?.toLowerCase() === params.stageName!.toLowerCase());
    if (!stage || stage.id === undefined) {
      throw new Error(
        `Stage '${params.stageName}' not found in release pipeline ${params.releasePipelineId}. ` +
          `Available stages: ${environments.map((e) => e.name).join(", ")}`
      );
    }

    const artifacts = definition.artifacts || [];
    const artifact = params.artifactAlias
      ? artifacts.find((a) => a.alias === params.artifactAlias)
      : artifacts.find((a) => a.type === "Build" && Number(a.definitionReference?.definition?.id) === params.buildPipelineId) ||
        artifacts.find((a) => a.type === "Build");
    if (!artifact) {
      throw new Error(`No build artifact found on release pipeline ${params.releasePipelineId}`);
    }

    const build = await this.resolveBuild(params.buildPipelineId!, params.buildId, params.buildNumber);
    const variableName = params.runIdVariableName || "test.RunId";

    const release = await releaseApi.createRelease(
      {
        definitionId: params.releasePipelineId,
        description: `Test run ${runId}`,
        artifacts: [{ alias: artifact.alias, instanceReference: { id: String(build.id), name: build.buildNumber } }],
        // Every stage is manual so creating the release deploys nothing; the chosen one is started below.
        manualEnvironments: environments.map((e) => e.name!),
        variables: { [variableName]: { value: String(runId) } },
      },
      this.config.project
    );

    const releaseEnvironment = (release.environments || []).find((e) => e.definitionEnvironmentId === stage.id);
    if (!releaseEnvironment?.id) {
      throw new Error(`Release ${release.id} was created but stage '${params.stageName}' was not found on it`);
    }
    await releaseApi.updateReleaseEnvironment(
      { status: EnvironmentStatus.InProgress, comment: `Started by test run ${runId}` },
      this.config.project,
      release.id!,
      releaseEnvironment.id
    );

    const testApi = await this.getTestApi();
    await testApi.updateTestRun(
      {
        releaseUri: `vstfs:///ReleaseManagement/Release/${release.id}`,
        releaseEnvironmentUri: `vstfs:///ReleaseManagement/Environment/${releaseEnvironment.id}`,
        build: { id: String(build.id) },
      },
      this.config.project,
      runId
    );

    return { id: release.id, name: release.name, stage: stage.name! };
  }

  /** Fetch a test case's steps from its work item. */
  protected async getTestCaseSteps(testCaseId: number): Promise<ParsedTestStep[]> {
    const witApi = await this.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(testCaseId, ["Microsoft.VSTS.TCM.Steps"], undefined, undefined, this.config.project);
    return parseTestSteps(workItem?.fields?.["Microsoft.VSTS.TCM.Steps"]);
  }

  protected async getResultWithIterations(runId: number, resultId: number) {
    const testApi = await this.getTestApi();
    return await testApi.getTestResultById(this.config.project, runId, resultId, ResultDetails.Iterations);
  }

  public async getTestResult(params: GetTestResultParams) {
    try {
      const testApi = await this.getTestApi();
      const result = await this.getResultWithIterations(params.runId, params.resultId);
      const attachments = await testApi.getTestResultAttachments(this.config.project, params.runId, params.resultId);

      let steps;
      if (params.includeSteps !== false && result.testCase?.id) {
        const recorded = new Map(
          (result.iterationDetails?.[0]?.actionResults || []).map((a) => [a.actionPath, a])
        );
        steps = (await this.getTestCaseSteps(Number(result.testCase.id))).map((s) => ({
          stepId: s.id,
          type: s.type,
          action: s.action,
          expectedResult: s.expectedResult,
          outcome: recorded.get(s.actionPath)?.outcome,
          comment: recorded.get(s.actionPath)?.errorMessage,
        }));
      }

      return {
        runId: params.runId,
        resultId: params.resultId,
        testCaseId: result.testCase?.id ? Number(result.testCase.id) : undefined,
        testCaseTitle: result.testCaseTitle,
        outcome: result.outcome,
        state: result.state,
        comment: result.comment,
        errorMessage: result.errorMessage,
        failureType: result.failureType,
        resolutionState: result.resolutionState,
        owner: result.owner?.displayName,
        runBy: result.runBy?.displayName,
        associatedBugs: (result.associatedBugs || []).map((b) => Number(b.id)),
        steps,
        attachments: (attachments || []).map((a) => ({ id: a.id, fileName: a.fileName, size: a.size, url: a.url, comment: a.comment })),
      };
    } catch (error) {
      console.error(`Error getting test result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async setTestStepResults(params: SetTestStepResultsParams) {
    try {
      if ((!params.steps || params.steps.length === 0) && !params.allStepsOutcome) {
        throw new Error("Provide steps and/or allStepsOutcome");
      }
      const testApi = await this.getTestApi();
      const result = await this.getResultWithIterations(params.runId, params.resultId);
      if (!result.testCase?.id) {
        throw new Error(`Result ${params.resultId} has no test case`);
      }
      const steps = await this.getTestCaseSteps(Number(result.testCase.id));
      const byId = new Map(steps.map((s) => [s.id, s]));

      const updates = new Map<string, { outcome: string; comment?: string }>();
      if (params.allStepsOutcome) {
        for (const s of steps) {
          updates.set(s.actionPath, { outcome: params.allStepsOutcome, comment: params.allStepsComment });
        }
      }
      for (const u of params.steps || []) {
        const step = byId.get(u.stepId);
        if (!step) {
          throw new Error(`Step ${u.stepId} not found on test case ${result.testCase.id}. Steps: ${steps.map((s) => s.id).join(", ")}`);
        }
        updates.set(step.actionPath, { outcome: u.outcome, comment: u.comment });
      }

      // Keep outcomes already recorded for steps this call doesn't touch.
      const iteration = result.iterationDetails?.[0];
      const iterationId = iteration?.id ?? 1;
      const now = new Date();
      const actionResults = new Map<string, TestActionResultModel>(
        (iteration?.actionResults || []).map((a) => [a.actionPath!, a])
      );
      for (const [actionPath, update] of updates) {
        const step = steps.find((s) => s.actionPath === actionPath)!;
        actionResults.set(actionPath, {
          actionPath,
          iterationId,
          stepIdentifier: String(step.id),
          outcome: update.outcome,
          // The web runner shows a step's comment from errorMessage.
          errorMessage: update.comment ?? "",
          startedDate: now,
          completedDate: now,
        });
      }

      const all = [...actionResults.values()];
      const iterationOutcome = all.some((a) => a.outcome === "Failed")
        ? "Failed"
        : steps.length > 0 && steps.every((s) => actionResults.get(s.actionPath)?.outcome === "Passed")
          ? "Passed"
          : iteration?.outcome ?? "None";

      const updated = await testApi.updateTestResults(
        [
          {
            id: params.resultId,
            iterationDetails: [{ id: iterationId, outcome: iterationOutcome, actionResults: all }],
          },
        ],
        this.config.project,
        params.runId
      );
      return {
        runId: params.runId,
        resultId: params.resultId,
        stepsUpdated: updates.size,
        iterationOutcome,
        result: updated?.[0] && { outcome: updated[0].outcome, state: updated[0].state },
      };
    } catch (error) {
      console.error(`Error setting step results for ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async setTestResultOutcome(params: SetTestResultOutcomeParams) {
    try {
      const testApi = await this.getTestApi();
      const now = new Date();
      const paused = params.outcome === "Paused";
      const updated = await testApi.updateTestResults(
        [
          {
            id: params.resultId,
            outcome: params.outcome,
            state: paused ? "Paused" : "Completed",
            comment: params.comment,
            completedDate: paused ? undefined : now,
          },
        ],
        this.config.project,
        params.runId
      );
      return {
        runId: params.runId,
        resultId: params.resultId,
        outcome: updated?.[0]?.outcome,
        state: updated?.[0]?.state,
      };
    } catch (error) {
      console.error(`Error setting outcome for ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async completeTestRun(params: CompleteTestRunParams) {
    try {
      const testApi = await this.getTestApi();
      const run = await testApi.updateTestRun(
        { state: "Completed", comment: params.comment, completedDate: new Date().toISOString() },
        this.config.project,
        params.runId
      );
      return { runId: run.id, state: run.state, totalTests: run.totalTests, passedTests: run.passedTests };
    } catch (error) {
      console.error(`Error completing test run ${params.runId}:`, error);
      throw error;
    }
  }

  private buildAttachmentRequest(params: AttachmentContentParams, kind?: TestAttachmentKind): TestAttachmentRequestModel {
    if (params.filePath && params.base64Content) {
      throw new Error("Provide either filePath or base64Content, not both.");
    }
    let stream: string;
    let fileName: string;
    if (params.filePath) {
      if (!fs.existsSync(params.filePath)) {
        throw new Error(`File not found: ${params.filePath}`);
      }
      const size = fs.statSync(params.filePath).size;
      if (size > MAX_TEST_ATTACHMENT_BYTES) {
        throw new Error(`File is ${Math.round(size / 1048576)} MB; the limit is ${MAX_TEST_ATTACHMENT_BYTES / 1048576} MB`);
      }
      stream = fs.readFileSync(params.filePath).toString("base64");
      fileName = params.fileName || path.basename(params.filePath);
    } else if (params.base64Content) {
      if (!params.fileName) {
        throw new Error("fileName is required when uploading via base64Content.");
      }
      stream = params.base64Content;
      fileName = params.fileName;
    } else {
      throw new Error("Provide filePath or base64Content.");
    }

    const ext = path.extname(fileName).toLowerCase();
    if (kind === "screenshot" && !IMAGE_EXTENSIONS.includes(ext)) {
      throw new Error(`A screenshot must be an image (${IMAGE_EXTENSIONS.join(", ")}), got '${ext || fileName}'`);
    }
    if (kind === "recording" && !VIDEO_EXTENSIONS.includes(ext)) {
      throw new Error(`A recording must be a video (${VIDEO_EXTENSIONS.join(", ")}), got '${ext || fileName}'`);
    }
    return { attachmentType: "GeneralAttachment", comment: params.comment, fileName, stream };
  }

  public async addTestResultAttachment(params: AddTestResultAttachmentParams) {
    try {
      const request = this.buildAttachmentRequest(params, params.kind);
      const testApi = await this.getTestApi();
      let reference;
      if (params.stepId !== undefined) {
        const result = await this.getResultWithIterations(params.runId, params.resultId);
        const step = (await this.getTestCaseSteps(Number(result.testCase?.id))).find((s) => s.id === params.stepId);
        if (!step) {
          throw new Error(`Step ${params.stepId} not found on test case ${result.testCase?.id}`);
        }
        reference = await testApi.createTestIterationResultAttachment(
          request, this.config.project, params.runId, params.resultId, result.iterationDetails?.[0]?.id ?? 1, step.actionPath
        );
      } else {
        reference = await testApi.createTestResultAttachment(request, this.config.project, params.runId, params.resultId);
      }
      return { runId: params.runId, resultId: params.resultId, stepId: params.stepId, fileName: request.fileName, attachment: reference };
    } catch (error) {
      console.error(`Error adding attachment to result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async addTestRunAttachment(params: AddTestRunAttachmentParams) {
    try {
      const request = this.buildAttachmentRequest(params);
      const testApi = await this.getTestApi();
      const reference = await testApi.createTestRunAttachment(request, this.config.project, params.runId);
      return { runId: params.runId, fileName: request.fileName, attachment: reference };
    } catch (error) {
      console.error(`Error adding attachment to run ${params.runId}:`, error);
      throw error;
    }
  }

  public async addTestResultComment(params: AddTestResultCommentParams) {
    try {
      const testApi = await this.getTestApi();
      let comment = params.comment;
      if (!params.replace) {
        const existing = await testApi.getTestResultById(this.config.project, params.runId, params.resultId);
        comment = existing.comment ? `${existing.comment}\n${params.comment}` : params.comment;
      }
      const updated = await testApi.updateTestResults([{ id: params.resultId, comment }], this.config.project, params.runId);
      return { runId: params.runId, resultId: params.resultId, comment: updated?.[0]?.comment ?? comment };
    } catch (error) {
      console.error(`Error commenting on result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async updateTestResultAnalysis(params: UpdateTestResultAnalysisParams) {
    try {
      if (params.failureType === undefined && params.resolutionState === undefined && params.comment === undefined) {
        throw new Error("Provide at least one of failureType, resolutionState, comment");
      }
      const testApi = await this.getTestApi();
      const updated = await testApi.updateTestResults(
        [{ id: params.resultId, failureType: params.failureType, resolutionState: params.resolutionState, comment: params.comment }],
        this.config.project,
        params.runId
      );
      const r = updated?.[0];
      return { runId: params.runId, resultId: params.resultId, failureType: r?.failureType, resolutionState: r?.resolutionState, comment: r?.comment };
    } catch (error) {
      console.error(`Error updating analysis for ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  /** Apply a point update per suite, since the points API is scoped to a suite. */
  private async updatePoints(selection: TestPointSelection, update: PointUpdateModel) {
    const { points, unresolvedTestCaseIds } = await this.resolveTestPoints(selection.planId, selection.testCaseIds, selection.suiteId);
    if (points.length === 0) {
      throw new Error(`No test points found in plan ${selection.planId} for test cases ${selection.testCaseIds.join(", ")}`);
    }
    const testApi = await this.getTestApi();
    const bySuite = new Map<number, number[]>();
    for (const p of points) {
      bySuite.set(p.suiteId!, [...(bySuite.get(p.suiteId!) || []), p.pointId]);
    }
    const updated = [];
    for (const [suiteId, pointIds] of bySuite) {
      updated.push(...(await testApi.updateTestPoints(update, this.config.project, selection.planId, suiteId, pointIds.join(","))));
    }
    return {
      updatedPoints: updated.map((p) => ({
        pointId: p.id,
        testCaseId: p.testCase?.id ? Number(p.testCase.id) : undefined,
        tester: p.assignedTo?.displayName,
        outcome: p.outcome,
        state: p.state,
      })),
      unresolvedTestCaseIds,
    };
  }

  public async assignTester(params: AssignTesterParams) {
    try {
      const { id, uniqueName, displayName } = params.tester;
      if (!id && !uniqueName && !displayName) {
        throw new Error("tester needs an id, uniqueName or displayName");
      }
      return await this.updatePoints(params, { tester: { id, uniqueName, displayName } });
    } catch (error) {
      console.error("Error assigning tester:", error);
      throw error;
    }
  }

  public async resetTestToActive(params: ResetTestToActiveParams) {
    try {
      return await this.updatePoints(params, { resetToActive: true });
    } catch (error) {
      console.error("Error resetting tests to active:", error);
      throw error;
    }
  }

  private summarizeRun(run: TestRun) {
    return {
      runId: run.id,
      name: run.name,
      state: run.state,
      isAutomated: run.isAutomated,
      owner: run.owner?.displayName,
      plan: run.plan?.name,
      startedDate: run.startedDate,
      completedDate: run.completedDate,
      totalTests: run.totalTests,
      passedTests: run.passedTests,
      incompleteTests: run.incompleteTests,
      unanalyzedTests: run.unanalyzedTests,
      build: run.build?.id ? { id: run.build.id, name: run.build.name } : undefined,
      release: run.release?.id ? { id: run.release.id, name: run.release.name } : undefined,
      url: run.webAccessUrl,
    };
  }

  public async getTestRuns(params: GetTestRunsParams) {
    try {
      const testApi = await this.getTestApi();
      if (params.runId !== undefined) {
        const run = await testApi.getTestRunById(this.config.project, params.runId, true);
        const results = await testApi.getTestResults(this.config.project, params.runId);
        return {
          runs: [this.summarizeRun(run)],
          results: results.map((r) => ({
            resultId: r.id,
            testCaseId: r.testCase?.id ? Number(r.testCase.id) : undefined,
            testCaseTitle: r.testCaseTitle,
            outcome: r.outcome,
            state: r.state,
            runBy: r.runBy?.displayName,
          })),
        };
      }
      const runs = await testApi.getTestRuns(
        this.config.project,
        params.buildId !== undefined ? `vstfs:///Build/Build/${params.buildId}` : undefined,
        params.owner,
        undefined,
        params.planId,
        false,
        params.automated,
        undefined,
        params.top ?? 25
      );
      return { runs: (runs || []).map((r) => this.summarizeRun(r)) };
    } catch (error) {
      console.error("Error getting test runs:", error);
      throw error;
    }
  }

  public async getTestCaseExecutionHistory(params: GetTestCaseExecutionHistoryParams) {
    try {
      const testApi = await this.getTestApi();
      const response = await testApi.getTestResultsByQuery(
        {
          resultsFilter: {
            automatedTestName: "",
            testCaseId: params.testCaseId,
            testPlanId: params.planId,
            resultsCount: params.top ?? 25,
          },
        },
        this.config.project
      );
      const results = response?.results || [];
      return {
        testCaseId: params.testCaseId,
        count: results.length,
        executions: results.map((r) => ({
          runId: r.testRun?.id ? Number(r.testRun.id) : undefined,
          runName: r.testRun?.name,
          resultId: r.id,
          outcome: r.outcome,
          state: r.state,
          runBy: r.runBy?.displayName,
          completedDate: r.completedDate,
          configuration: r.configuration?.name,
          build: r.build?.name,
          associatedBugs: (r.associatedBugs || []).map((b) => Number(b.id)),
        })),
      };
    } catch (error) {
      console.error(`Error getting execution history for test case ${params.testCaseId}:`, error);
      throw error;
    }
  }

  public async linkTestRunToWorkItems(params: LinkTestRunToWorkItemsParams) {
    try {
      if (!params.workItemIds || params.workItemIds.length === 0) {
        throw new Error("workItemIds must contain at least one work item id");
      }
      const testApi = await this.getTestApi();
      const run = await testApi.getTestRunById(this.config.project, params.runId);

      const resultIds =
        params.resultId !== undefined
          ? [params.resultId]
          : (await testApi.getTestResults(this.config.project, params.runId)).map((r) => r.id!);

      // associatedBugs replaces the list, so merge with what each result already has.
      const updates = [];
      for (const resultId of resultIds) {
        const existing = await testApi.getTestResultById(this.config.project, params.runId, resultId, ResultDetails.WorkItems);
        const ids = new Set((existing.associatedBugs || []).map((b) => String(b.id)));
        params.workItemIds.forEach((id) => ids.add(String(id)));
        updates.push({ id: resultId, associatedBugs: [...ids].map((id) => ({ id })) });
      }
      await testApi.updateTestResults(updates, this.config.project, params.runId);

      const hyperlinked: number[] = [];
      if (params.addRunHyperlink !== false && run.webAccessUrl) {
        for (const workItemId of params.workItemIds) {
          if (await this.addRunHyperlink(workItemId, run.webAccessUrl, `Test run ${params.runId}: ${run.name}`)) {
            hyperlinked.push(workItemId);
          }
        }
      }
      return { runId: params.runId, resultsLinked: resultIds, workItemIds: params.workItemIds, hyperlinked };
    } catch (error) {
      console.error(`Error linking test run ${params.runId} to work items:`, error);
      throw error;
    }
  }

  /** Add a hyperlink to a run on a work item unless one is already there. Returns true when added. */
  protected async addRunHyperlink(workItemId: number, url: string, comment: string): Promise<boolean> {
    const witApi = await this.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(workItemId, undefined, undefined, WorkItemExpand.Relations, this.config.project);
    if ((workItem.relations || []).some((r) => r.rel === "Hyperlink" && r.url === url)) {
      return false;
    }
    await witApi.updateWorkItem(
      undefined,
      [{ op: Operation.Add, path: "/relations/-", value: { rel: "Hyperlink", url, attributes: { comment } } }],
      workItemId,
      this.config.project
    );
    return true;
  }

  // __METHODS__
}
