import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { ITestApi } from "azure-devops-node-api/TestApi";
import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import { IReleaseApi } from "azure-devops-node-api/ReleaseApi";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { ITestResultsApi } from "azure-devops-node-api/TestResultsApi";
import { BuildQueryOrder, BuildStatus } from "azure-devops-node-api/interfaces/BuildInterfaces";
import { EnvironmentStatus } from "azure-devops-node-api/interfaces/ReleaseInterfaces";
import { downloadStreamToFile } from "../utils/downloadStreamToFile";
import { readStreamWithLimit } from "../utils/readStreamWithLimit";
import * as fs from "fs";
import * as path from "path";
import {
  FailureType,
  Outcome as TestPlanOutcome,
  PointState,
  ResultState,
} from "azure-devops-node-api/interfaces/TestPlanInterfaces";
import { Operation } from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { WorkItemExpand } from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import {
  ListTestResolutionStatesParams,
  CreateBugFromTestRunParams,
  UpdateBugWithTestRunParams,
  GetTestCaseExecutionHistoryParams,
  GetTestPointsParams,
  GetTestRunsParams,
  LinkTestRunToWorkItemsParams,
} from "../Interfaces/TestExecution";
import {
  PointUpdateModel,
  ResultDetails,
  TestCaseResult,
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
  DeleteTestRunAttachmentParams,
  GetTestRunAttachmentParams,
  ListTestRunAttachmentsParams,
  TesterIdentity,
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
// Upper bound on run-name lookups for one history response.
const MAX_RUN_NAME_LOOKUPS = 25;
// Largest attachment returned inline as base64; anything bigger has to be saved to a file.
const MAX_INLINE_ATTACHMENT_BYTES = 64 * 1024;
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

/** Name of a numeric enum value; the value itself when it is not a known member. */
function enumName(enumObject: object, value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  // These enums give their top value a second name, MaxValue, which reverse lookup would pick.
  const entries = Object.entries(enumObject as Record<string, string | number>);
  const name = entries.find(([key, v]) => typeof v === "number" && v === value && key !== "MaxValue")?.[0];
  return name ?? String(value);
}

/** True when two hyperlinks are the same, or point at the same test run (any view of it). */
function sameRunLink(a: string | undefined, b: string): boolean {
  if (!a) {
    return false;
  }
  if (a === b) {
    return true;
  }
  const runOf = (url: string) => /[?&]runId=(\d+)/i.exec(url)?.[1];
  const runA = runOf(a);
  return runA !== undefined && runA === runOf(b);
}

/** Union of bug ids from two sources, keeping order. */
function mergeBugIds(known: number[] | undefined, refs: { id?: string }[] | undefined): number[] {
  return [...new Set([...(known || []), ...(refs || []).map((b) => Number(b.id))])];
}

const toActionPath = (id: number) => id.toString(16).padStart(8, "0");

/**
 * Parse the Microsoft.VSTS.TCM.Steps XML of a test case (or shared step set) into rows, in
 * document order. A <compref> shared-step reference becomes a SharedStepReference row whose
 * children are not known here - see TestExecutionService.expandSteps.
 */
export function parseTestSteps(stepsXml: string | undefined): ParsedTestStep[] {
  if (!stepsXml) {
    return [];
  }
  const steps: ParsedTestStep[] = [];
  const rowRegex =
    /<step\s+id="(\d+)"\s+type="(ActionStep|ValidateStep)"[^>]*>([\s\S]*?)<\/step>|<compref\s+id="(\d+)"\s+ref="(\d+)"\s*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(stepsXml)) !== null) {
    if (match[4] !== undefined) {
      const id = parseInt(match[4], 10);
      steps.push({
        id,
        identifier: String(id),
        actionPath: toActionPath(id),
        type: "SharedStepReference",
        action: "",
        expectedResult: "",
        sharedStepId: parseInt(match[5], 10),
      });
      continue;
    }
    const strings = [...match[3].matchAll(/<parameterizedString[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map((m) => m[1]);
    const id = parseInt(match[1], 10);
    steps.push({
      id,
      identifier: String(id),
      actionPath: toActionPath(id),
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

  protected async getTestResultsApi(): Promise<ITestResultsApi> {
    return await this.connection.getTestResultsApi();
  }

  protected async getBuildApi(): Promise<IBuildApi> {
    return await this.connection.getBuildApi();
  }

  /**
   * Resolve the test points (test case + configuration pairs) in a plan for the given test
   * cases. When suiteId is omitted each test case's suites are looked up and filtered to the
   * plan. A test case with several configurations yields one point per configuration.
   */
  /** Group test cases by the suite of the plan that holds them: suite id -> test case ids. */
  private async groupTestCasesBySuite(planId: number, testCaseIds: number[], suiteId?: number): Promise<Map<number, number[]>> {
    const bySuite = new Map<number, number[]>();
    if (suiteId !== undefined) {
      bySuite.set(suiteId, [...testCaseIds]);
      return bySuite;
    }
    const testPlanApi = await this.getTestPlanApi();
    for (const testCaseId of testCaseIds) {
      const suites = await testPlanApi.getSuitesByTestCaseId(testCaseId);
      for (const suite of suites || []) {
        if (suite.plan?.id === planId && suite.id !== undefined) {
          bySuite.set(suite.id, [...(bySuite.get(suite.id) || []), testCaseId]);
        }
      }
    }
    return bySuite;
  }

  protected async resolveTestPoints(
    planId: number,
    testCaseIds: number[],
    suiteId?: number
  ): Promise<{ points: ResolvedTestPoint[]; unresolvedTestCaseIds: number[] }> {
    const testPlanApi = await this.getTestPlanApi();
    const bySuite = await this.groupTestCasesBySuite(planId, testCaseIds, suiteId);

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

  /**
   * Parse a steps field and expand each shared-step reference into the reference row followed by
   * the steps of the shared set, with paths and identifiers as the web UI records them
   * (child path = parent path + child path, identifier "parent;child").
   */
  protected async expandSteps(stepsXml: string | undefined): Promise<ParsedTestStep[]> {
    const rows = parseTestSteps(stepsXml);
    if (!rows.some((r) => r.type === "SharedStepReference")) {
      return rows;
    }
    const witApi = await this.getWorkItemTrackingApi();
    const expanded: ParsedTestStep[] = [];
    for (const row of rows) {
      if (row.type !== "SharedStepReference") {
        expanded.push(row);
        continue;
      }
      const shared = await witApi.getWorkItem(
        row.sharedStepId!,
        ["Microsoft.VSTS.TCM.Steps", "System.Title"],
        undefined,
        undefined,
        this.config.project
      );
      expanded.push({
        ...row,
        action: `Shared steps: ${shared?.fields?.["System.Title"] ?? row.sharedStepId}`,
        sharedStepRevision: shared?.rev,
      });
      for (const child of parseTestSteps(shared?.fields?.["Microsoft.VSTS.TCM.Steps"])) {
        if (child.type === "SharedStepReference") {
          continue; // shared step sets can't contain other shared step sets
        }
        expanded.push({
          ...child,
          identifier: `${row.identifier};${child.id}`,
          actionPath: row.actionPath + child.actionPath,
          sharedStepId: row.sharedStepId,
          parentIdentifier: row.identifier,
        });
      }
    }
    return expanded;
  }

  /** Fetch a test case's steps (shared steps expanded) from its work item. */
  protected async getTestCaseSteps(testCaseId: number): Promise<ParsedTestStep[]> {
    const witApi = await this.getWorkItemTrackingApi();
    const workItem = await witApi.getWorkItem(testCaseId, ["Microsoft.VSTS.TCM.Steps"], undefined, undefined, this.config.project);
    return await this.expandSteps(workItem?.fields?.["Microsoft.VSTS.TCM.Steps"]);
  }

  protected async getResultWithIterations(runId: number, resultId: number) {
    const testApi = await this.getTestApi();
    return await testApi.getTestResultById(this.config.project, runId, resultId, ResultDetails.Iterations | ResultDetails.WorkItems);
  }

  public async getTestResult(params: GetTestResultParams) {
    try {
      const testApi = await this.getTestApi();
      const result = await this.getResultWithIterations(params.runId, params.resultId);
      const attachments = await testApi.getTestResultAttachments(this.config.project, params.runId, params.resultId);

      let steps;
      let unmatchedStepResults;
      if (params.includeSteps !== false && result.testCase?.id) {
        const actionResults = result.iterationDetails?.[0]?.actionResults || [];
        const recorded = new Map(actionResults.map((a) => [a.actionPath?.toLowerCase(), a]));
        const testCaseSteps = await this.getTestCaseSteps(Number(result.testCase.id));
        // Outcomes recorded under a path no listed step maps to (e.g. shared-step children, or
        // another client's path format) would otherwise be silently invisible here.
        const knownPaths = new Set(testCaseSteps.map((s) => s.actionPath));
        const unmatched = actionResults.filter((a) => !knownPaths.has(a.actionPath!.toLowerCase()));
        unmatchedStepResults = unmatched.length
          ? unmatched.map((a) => ({ actionPath: a.actionPath, outcome: a.outcome, comment: a.errorMessage }))
          : undefined;
        steps = testCaseSteps.map((s) => ({
          // a number for a top-level step, "3;5" for a step inside a shared set
          stepId: s.parentIdentifier ? s.identifier : s.id,
          type: s.type,
          action: s.action,
          expectedResult: s.expectedResult,
          sharedStepId: s.sharedStepId,
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
        analysisOwner: result.owner ? { id: result.owner.id, displayName: result.owner.displayName, uniqueName: result.owner.uniqueName } : undefined,
        runBy: result.runBy?.displayName,
        associatedBugs: (result.associatedBugs || []).map((b) => Number(b.id)),
        steps,
        unmatchedStepResults,
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
      const byId = new Map(steps.map((s) => [s.identifier, s]));

      const updates = new Map<string, { outcome: string; comment?: string }>();
      if (params.allStepsOutcome) {
        for (const s of steps) {
          updates.set(s.actionPath, { outcome: params.allStepsOutcome, comment: params.allStepsComment });
        }
      }
      for (const u of params.steps || []) {
        const step = byId.get(String(u.stepId));
        if (!step) {
          throw new Error(`Step ${u.stepId} not found on test case ${result.testCase.id}. Steps: ${steps.map((s) => s.identifier).join(", ")}`);
        }
        updates.set(step.actionPath, { outcome: u.outcome, comment: u.comment });
      }

      // Keep outcomes already recorded for steps this call doesn't touch.
      const iteration = result.iterationDetails?.[0];
      const iterationId = iteration?.id ?? 1;
      const now = new Date();
      const actionResults = new Map<string, TestActionResultModel>(
        (iteration?.actionResults || []).map((a) => [a.actionPath!.toLowerCase(), a])
      );
      for (const [actionPath, update] of updates) {
        const step = steps.find((s) => s.actionPath === actionPath)!;
        actionResults.set(actionPath, {
          actionPath,
          iterationId,
          stepIdentifier: step.identifier,
          ...(step.type === "SharedStepReference" && { sharedStepModel: { id: step.sharedStepId!, revision: step.sharedStepRevision ?? 1 } }),
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
          await this.buildResultUpdate(result, {
            id: params.resultId,
            iterationDetails: [{ id: iterationId, outcome: iterationOutcome, actionResults: all }],
          }),
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
      const existing = await testApi.getTestResultById(this.config.project, params.runId, params.resultId);
      const updated = await testApi.updateTestResults(
        [
          await this.buildResultUpdate(existing, {
            id: params.resultId,
            outcome: params.outcome,
            state: paused ? "Paused" : "Completed",
            comment: params.comment,
            completedDate: paused ? undefined : now,
          }),
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
        const step = (await this.getTestCaseSteps(Number(result.testCase?.id))).find((s) => s.identifier === String(params.stepId));
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

  public async listTestRunAttachments(params: ListTestRunAttachmentsParams) {
    try {
      const testApi = await this.getTestApi();
      const attachments = (await testApi.getTestRunAttachments(this.config.project, params.runId)) || [];
      return {
        runId: params.runId,
        count: attachments.length,
        attachments: attachments.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          size: a.size,
          comment: a.comment,
          createdDate: a.createdDate,
          url: a.url,
        })),
      };
    } catch (error) {
      console.error(`Error listing attachments of test run ${params.runId}:`, error);
      throw error;
    }
  }

  /** Find one attachment of a run, with a clear error listing what exists when it isn't there. */
  private async findTestRunAttachment(runId: number, attachmentId: number) {
    const testApi = await this.getTestApi();
    const attachments = (await testApi.getTestRunAttachments(this.config.project, runId)) || [];
    const match = attachments.find((a) => a.id === attachmentId);
    if (!match) {
      throw new Error(
        `Test run ${runId} has no attachment ${attachmentId}. Attachments: ${attachments.map((a) => `${a.id} (${a.fileName})`).join(", ") || "none"}`
      );
    }
    return match;
  }

  public async getTestRunAttachment(params: GetTestRunAttachmentParams) {
    try {
      const attachment = await this.findTestRunAttachment(params.runId, params.attachmentId);
      const fileName = attachment.fileName || `attachment-${attachment.id}`;
      const testApi = await this.getTestApi();
      const stream = await testApi.getTestRunAttachmentContent(this.config.project, params.runId, params.attachmentId);

      if (params.savePath) {
        // an existing folder gets the attachment's own file name
        const isFolder = fs.existsSync(params.savePath) && fs.statSync(params.savePath).isDirectory();
        const target = isFolder ? path.join(params.savePath, path.basename(fileName)) : params.savePath;
        const { savePath, size } = await downloadStreamToFile(stream, target);
        return { runId: params.runId, attachmentId: attachment.id, fileName, savePath, size };
      }

      const buffer = await readStreamWithLimit(stream, MAX_INLINE_ATTACHMENT_BYTES);
      return { runId: params.runId, attachmentId: attachment.id, fileName, size: buffer.length, base64Content: buffer.toString("base64") };
    } catch (error) {
      console.error(`Error getting attachment ${params.attachmentId} of test run ${params.runId}:`, error);
      throw error;
    }
  }

  /**
   * Permanently delete a run attachment. This goes through the Test Results API (the web UI's
   * route): the Test API serves the same attachments but rejects DELETE.
   */
  public async deleteTestRunAttachment(params: DeleteTestRunAttachmentParams) {
    try {
      const attachment = await this.findTestRunAttachment(params.runId, params.attachmentId);
      const testResultsApi = await this.getTestResultsApi();
      await testResultsApi.deleteTestRunAttachment(this.config.project, params.runId, params.attachmentId);
      return { runId: params.runId, attachmentId: params.attachmentId, fileName: attachment.fileName, deleted: true };
    } catch (error) {
      console.error(`Error deleting attachment ${params.attachmentId} of test run ${params.runId}:`, error);
      throw error;
    }
  }

  public async addTestResultComment(params: AddTestResultCommentParams) {
    try {
      const testApi = await this.getTestApi();
      const existing = await testApi.getTestResultById(this.config.project, params.runId, params.resultId);
      const comment = !params.replace && existing.comment ? `${existing.comment}\n${params.comment}` : params.comment;
      const updated = await testApi.updateTestResults(
        [await this.buildResultUpdate(existing, { id: params.resultId, comment })],
        this.config.project,
        params.runId
      );
      return { runId: params.runId, resultId: params.resultId, comment: updated?.[0]?.comment ?? comment };
    } catch (error) {
      console.error(`Error commenting on result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  /**
   * List the project's test resolution states. Their ids and names are configured per project
   * (not a fixed 1-4), and the results API stores a resolution by id, silently ignoring a name.
   * The SDK has no client for this, so it reads the TCMServiceMigration/testresolutionstate route.
   */
  public async listTestResolutionStates(_params: ListTestResolutionStatesParams = {}) {
    try {
      const apiVersion = this.config.isOnPremises ? this.config.apiVersion || "5.0-preview.1" : "7.1-preview.1";
      const url = `${this.webBaseUrl()}/_apis/TCMServiceMigration/testresolutionstate?api-version=${apiVersion}`;
      const response = await this.connection.rest.get<{ value?: { id: number; name: string }[] }>(url);
      if (response.statusCode !== 200 || !response.result?.value) {
        throw new Error(
          `Could not read the project's resolution states (HTTP ${response.statusCode}); pass resolutionStateId instead of resolutionState`
        );
      }
      return response.result.value.map((s) => ({ id: s.id, name: s.name }));
    } catch (error) {
      console.error("Error listing test resolution states:", error);
      throw error;
    }
  }

  private async resolveResolutionStateId(name?: string, id?: number): Promise<number | undefined> {
    if (id !== undefined) {
      return id;
    }
    if (name === undefined) {
      return undefined;
    }
    const states = await this.listTestResolutionStates();
    const match = states.find((s) => s.name.toLowerCase() === name.trim().toLowerCase());
    if (!match) {
      throw new Error(`Unknown resolution state '${name}'. Available: ${states.map((s) => s.name).join(", ")}`);
    }
    return match.id;
  }

  /**
   * Build an update for a result that keeps its failure type and resolution. Azure DevOps resets
   * both to their defaults (None / unset) on any update that doesn't send them - even one that
   * only adds a comment or marks a step - so every update re-sends what the result already has.
   * Fields in `patch` that are undefined are ignored; the rest override.
   */
  protected async buildResultUpdate(existing: TestCaseResult, patch: TestCaseResult): Promise<TestCaseResult> {
    const update: TestCaseResult = {};
    if (existing.failureType && existing.failureType !== "None") {
      update.failureType = existing.failureType;
    }
    let resolutionStateId = existing.resolutionStateId;
    if (!resolutionStateId && existing.resolutionState) {
      const states = await this.listTestResolutionStates();
      resolutionStateId = states.find((st) => st.name.toLowerCase() === existing.resolutionState!.toLowerCase())?.id;
    }
    if (resolutionStateId) {
      update.resolutionStateId = resolutionStateId;
    }
    if (existing.owner?.id) {
      update.owner = { id: existing.owner.id } as TestCaseResult["owner"];
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        (update as Record<string, unknown>)[key] = value;
      }
    }
    return update;
  }

  public async updateTestResultAnalysis(params: UpdateTestResultAnalysisParams) {
    try {
      if (
        params.failureType === undefined && params.resolutionState === undefined &&
        params.resolutionStateId === undefined && params.analysisOwner === undefined && params.comment === undefined
      ) {
        throw new Error("Provide at least one of failureType, resolutionState, resolutionStateId, analysisOwner, comment");
      }
      const testApi = await this.getTestApi();
      const resolutionStateId = await this.resolveResolutionStateId(params.resolutionState, params.resolutionStateId);
      const owner = params.analysisOwner ? await this.resolveTester(params.analysisOwner) : undefined;
      const current = await testApi.getTestResultById(this.config.project, params.runId, params.resultId);
      await testApi.updateTestResults(
        [await this.buildResultUpdate(current, { id: params.resultId, failureType: params.failureType, resolutionStateId, owner: owner as TestCaseResult["owner"], comment: params.comment })],
        this.config.project,
        params.runId
      );
      // The update response doesn't echo the analysis fields, so read them back.
      const r = await testApi.getTestResultById(this.config.project, params.runId, params.resultId);
      return {
        runId: params.runId,
        resultId: params.resultId,
        failureType: r.failureType,
        resolutionState: r.resolutionState,
        analysisOwner: r.owner ? { id: r.owner.id, displayName: r.owner.displayName, uniqueName: r.owner.uniqueName } : undefined,
        comment: r.comment,
      };
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

  /**
   * Azure DevOps only accepts a tester by identity GUID (anything else fails with a bare "Tester"
   * error), so find the GUID of a name or email among the project's team members.
   */
  private async resolveTester(tester: TesterIdentity): Promise<{ id: string; uniqueName?: string; displayName?: string }> {
    if (tester.id) {
      return { id: tester.id, uniqueName: tester.uniqueName, displayName: tester.displayName };
    }
    const needle = (tester.uniqueName ?? tester.displayName)!.trim().toLowerCase();
    const coreApi = await this.connection.getCoreApi();
    const teams = await coreApi.getTeams(this.config.project, false, 100);
    for (const team of teams || []) {
      const members = await coreApi.getTeamMembersWithExtendedProperties(this.config.project, team.id!);
      const match = (members || []).find(
        (m) => m.identity?.uniqueName?.toLowerCase() === needle || m.identity?.displayName?.toLowerCase() === needle
      );
      if (match?.identity?.id) {
        return { id: match.identity.id, uniqueName: match.identity.uniqueName, displayName: match.identity.displayName };
      }
    }
    throw new Error(
      `Could not find '${tester.uniqueName ?? tester.displayName}' among the members of the project's teams; pass the tester's identity GUID as tester.id`
    );
  }

  public async assignTester(params: AssignTesterParams) {
    try {
      const { id, uniqueName, displayName } = params.tester;
      if (!id && !uniqueName && !displayName) {
        throw new Error("tester needs an id, uniqueName or displayName");
      }
      return await this.updatePoints(params, { tester: await this.resolveTester(params.tester) });
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

  /**
   * Look up the name of each run and the bugs associated with its results. The results query
   * returns neither (names blank, bugs empty), so both come from the run itself. Runs that can't
   * be read are left out.
   */
  protected async getRunInfo(runIds: number[]): Promise<Map<number, { name?: string; bugs: Map<number, number[]> }>> {
    const info = new Map<number, { name?: string; bugs: Map<number, number[]> }>();
    const distinct = [...new Set(runIds.filter((id) => Number.isFinite(id)))].slice(0, MAX_RUN_NAME_LOOKUPS);
    const testApi = await this.getTestApi();
    await Promise.all(
      distinct.map(async (id) => {
        try {
          const run = await testApi.getTestRunById(this.config.project, id);
          const results = await testApi.getTestResults(this.config.project, id, ResultDetails.WorkItems);
          const bugs = new Map<number, number[]>();
          for (const r of results || []) {
            if (r.id !== undefined && r.associatedBugs?.length) {
              bugs.set(r.id, r.associatedBugs.map((b) => Number(b.id)));
            }
          }
          info.set(id, { name: run?.name || undefined, bugs });
        } catch {
          // a run that can't be read just keeps no name and no bugs
        }
      })
    );
    return info;
  }

  /**
   * Read test points: each test case + configuration pair in a suite, with its current
   * outcome, tester, last run and result, and when it was last reset to Active. With
   * includeHistory, also the recent results recorded against each point.
   */
  public async getTestPoints(params: GetTestPointsParams) {
    try {
      const hasCases = !!params.testCaseIds && params.testCaseIds.length > 0;
      if (!hasCases && params.suiteId === undefined) {
        throw new Error("Provide testCaseIds, a suiteId, or both");
      }
      const testPlanApi = await this.getTestPlanApi();
      const bySuite = hasCases
        ? await this.groupTestCasesBySuite(params.planId, params.testCaseIds!, params.suiteId)
        : new Map<number, number[]>([[params.suiteId!, []]]);

      const points = [];
      let moreAvailable = false;
      for (const [suiteId, caseIds] of bySuite) {
        const page = await testPlanApi.getPointsList(
          this.config.project, params.planId, suiteId, undefined, caseIds.length ? caseIds.join(",") : undefined,
          undefined, undefined, true, false
        );
        moreAvailable = moreAvailable || !!page.continuationToken;
        for (const p of page || []) {
          points.push({
            pointId: p.id,
            suiteId,
            testCaseId: p.testCaseReference?.id !== undefined ? Number(p.testCaseReference.id) : undefined,
            testCaseTitle: p.testCaseReference?.name,
            configuration: p.configuration?.name,
            isActive: p.isActive,
            isAutomated: p.isAutomated,
            tester: p.tester?.displayName,
            // the test plan API reports these as numbers; show the enum names
            outcome: enumName(TestPlanOutcome, p.results?.outcome),
            state: enumName(PointState, p.results?.state),
            lastResultState: enumName(ResultState, p.results?.lastResultState),
            lastRunId: p.results?.lastTestRunId,
            lastResultId: p.results?.lastResultId,
            lastRunBuild: p.results?.lastRunBuildNumber && p.results.lastRunBuildNumber !== "0" ? p.results.lastRunBuildNumber : undefined,
            lastResultDetails: p.results?.lastResultDetails,
            failureType: enumName(FailureType, p.results?.failureType),
            lastResetToActive: p.lastResetToActive,
            lastUpdatedBy: p.lastUpdatedBy?.displayName,
            lastUpdatedDate: p.lastUpdatedDate,
          });
        }
      }

      const wanted = hasCases ? new Set(params.testCaseIds) : undefined;
      const shown = wanted ? points.filter((p) => p.testCaseId !== undefined && wanted.has(p.testCaseId)) : points;
      const unresolvedTestCaseIds = wanted ? [...wanted].filter((id) => !shown.some((p) => p.testCaseId === id)) : [];

      let history: Record<number, unknown[]> | undefined;
      let historyError: string | undefined;
      if (params.includeHistory && shown.length > 0) {
        try {
          const testApi = await this.getTestApi();
          const top = params.historyTop ?? 10;
          // Querying by test point id only returns each point's latest result, so query by test
          // case (all of its results across runs) and group the results by the point they ran.
          const results = [];
          for (const testCaseId of new Set(shown.map((p) => p.testCaseId!))) {
            const response = await testApi.getTestResultsByQuery(
              { resultsFilter: { automatedTestName: "", testCaseId, testPlanId: params.planId, resultsCount: Math.max(25, top * 5) } },
              this.config.project
            );
            results.push(...(response?.results || []));
          }
          const runInfo = await this.getRunInfo(results.map((r) => Number(r.testRun?.id)));
          history = {};
          for (const r of results) {
            const pointId = Number(r.testPoint?.id);
            if (!shown.some((p) => p.pointId === pointId)) continue;
            const list = (history[pointId] = history[pointId] || []);
            if (list.length >= top) continue;
            list.push({
              runId: r.testRun?.id ? Number(r.testRun.id) : undefined,
              runName: runInfo.get(Number(r.testRun?.id))?.name || undefined,
              resultId: r.id,
              outcome: r.outcome,
              runBy: r.runBy?.displayName,
              completedDate: r.completedDate,
              associatedBugs: mergeBugIds(runInfo.get(Number(r.testRun?.id))?.bugs.get(r.id!), r.associatedBugs),
            });
          }
        } catch (error) {
          historyError = error instanceof Error ? error.message : String(error);
        }
      }

      return {
        planId: params.planId,
        count: shown.length,
        moreAvailable: moreAvailable || undefined,
        unresolvedTestCaseIds,
        points: shown.map((p) => ({ ...p, history: history?.[p.pointId] })),
        historyError,
      };
    } catch (error) {
      console.error(`Error getting test points for plan ${params.planId}:`, error);
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
      // The query leaves the run name blank, so look the names up.
      const runInfo = await this.getRunInfo(results.map((r) => Number(r.testRun?.id)));
      return {
        testCaseId: params.testCaseId,
        count: results.length,
        executions: results.map((r) => ({
          runId: r.testRun?.id ? Number(r.testRun.id) : undefined,
          runName: runInfo.get(Number(r.testRun?.id))?.name || r.testRun?.name || undefined,
          testPointId: r.testPoint?.id ? Number(r.testPoint.id) : undefined,
          resultId: r.id,
          outcome: r.outcome,
          state: r.state,
          runBy: r.runBy?.displayName,
          completedDate: r.completedDate,
          configuration: r.configuration?.name,
          build: r.build?.name,
          associatedBugs: mergeBugIds(runInfo.get(Number(r.testRun?.id))?.bugs.get(r.id!), r.associatedBugs),
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
        updates.push(await this.buildResultUpdate(existing, { id: resultId, associatedBugs: [...ids].map((id) => ({ id })) }));
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
    if ((workItem.relations || []).some((r) => r.rel === "Hyperlink" && sameRunLink(r.url, url))) {
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

  private webBaseUrl(): string {
    const base = this.config.isOnPremises && this.config.collection ? `${this.config.orgUrl}/${this.config.collection}` : this.config.orgUrl;
    return `${base.replace(/\/+$/, "")}/${encodeURIComponent(this.config.project)}`;
  }

  /** Gather everything a bug needs from a test result: steps, outcomes, comments, links. */
  private async buildFailureReport(runId: number, resultId: number, additionalDetails?: string) {
    const testApi = await this.getTestApi();
    const witApi = await this.getWorkItemTrackingApi();
    const result = await this.getResultWithIterations(runId, resultId);
    const run = await testApi.getTestRunById(this.config.project, runId);
    const attachments = (await testApi.getTestResultAttachments(this.config.project, runId, resultId)) || [];

    const testCaseId = result.testCase?.id ? Number(result.testCase.id) : undefined;
    if (testCaseId === undefined) {
      throw new Error(`Result ${resultId} in run ${runId} has no test case`);
    }
    const testCase = await witApi.getWorkItem(testCaseId, undefined, undefined, undefined, this.config.project);
    const steps = await this.expandSteps(testCase.fields?.["Microsoft.VSTS.TCM.Steps"]);
    const recorded = new Map((result.iterationDetails?.[0]?.actionResults || []).map((a) => [a.actionPath?.toLowerCase(), a]));

    const title = result.testCaseTitle || testCase.fields?.["System.Title"] || `Test case ${testCaseId}`;
    const resultUrl = `${this.webBaseUrl()}/_testManagement/runs?runId=${runId}&_a=resultSummary&resultId=${resultId}`;
    const e = escapeHtml;

    const stepRows = steps.map((s) => {
      const r = recorded.get(s.actionPath);
      const mark = r?.outcome === "Failed" ? " <b>[FAILED]</b>" : r?.outcome === "Passed" ? " [passed]" : "";
      const comment = r?.outcome === "Failed" && r.errorMessage ? `<br/><i>Comment:</i> ${e(r.errorMessage)}` : "";
      const expected = s.expectedResult ? `<br/><i>Expected:</i> ${e(s.expectedResult)}` : "";
      const indent = s.parentIdentifier ? "&nbsp;&nbsp;&nbsp;" : "";
      return `<li>${indent}<b>${e(s.identifier)}.</b> ${e(s.action)}${mark}${expected}${comment}</li>`;
    });

    const parts = [
      additionalDetails ? `<p>${e(additionalDetails)}</p>` : "",
      `<p>Test case <b>${testCaseId}</b>: ${e(title)}<br/>Outcome: <b>${e(result.outcome || "Unknown")}</b>` +
        `<br/>Run: <a href="${e(resultUrl)}">${e(run.name || `Run ${runId}`)} (result ${resultId})</a></p>`,
      result.comment ? `<p><b>Result comment:</b> ${e(result.comment)}</p>` : "",
      result.errorMessage ? `<p><b>Error:</b> ${e(result.errorMessage)}</p>` : "",
      stepRows.length ? `<p><b>Steps:</b></p><ul>${stepRows.join("")}</ul>` : "",
      attachments.length
        ? `<p><b>Attachments:</b></p><ul>${attachments.map((a) => `<li><a href="${e(a.url || "")}">${e(a.fileName || String(a.id))}</a></li>`).join("")}</ul>`
        : "",
    ];

    return {
      html: parts.filter(Boolean).join(""),
      title,
      testCaseId,
      testCaseUrl: testCase.url,
      areaPath: testCase.fields?.["System.AreaPath"] as string | undefined,
      iterationPath: testCase.fields?.["System.IterationPath"] as string | undefined,
      resultUrl,
      runName: run.name,
    };
  }

  /** Relations tying a work item to the test result, test case and run. */
  private resultRelations(report: { testCaseUrl?: string; resultUrl: string; runName?: string }, runId: number, resultId: number) {
    const relations: { rel: string; url: string; attributes: Record<string, string> }[] = [
      { rel: "ArtifactLink", url: `vstfs:///TestManagement/TcmResult/${runId}.${resultId}`, attributes: { name: "Test Result" } },
      { rel: "Hyperlink", url: report.resultUrl, attributes: { comment: `Test run ${runId}: ${report.runName ?? ""}`.trim() } },
    ];
    if (report.testCaseUrl) {
      relations.push({ rel: "Microsoft.VSTS.Common.TestedBy-Forward", url: report.testCaseUrl, attributes: { comment: "Test case that found this bug" } });
    }
    return relations;
  }

  public async createBugFromTestRun(params: CreateBugFromTestRunParams) {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const report = await this.buildFailureReport(params.runId, params.resultId, params.additionalDetails);

      const fields: Record<string, unknown> = {
        "System.Title": params.title || `${report.title} failed`,
        "Microsoft.VSTS.TCM.ReproSteps": report.html,
      };
      const areaPath = params.areaPath || report.areaPath;
      const iterationPath = params.iterationPath || report.iterationPath;
      if (areaPath) fields["System.AreaPath"] = areaPath;
      if (iterationPath) fields["System.IterationPath"] = iterationPath;
      if (params.assignedTo) fields["System.AssignedTo"] = params.assignedTo;
      if (params.severity) fields["Microsoft.VSTS.Common.Severity"] = params.severity;
      if (params.priority !== undefined) fields["Microsoft.VSTS.Common.Priority"] = params.priority;

      const patch = [
        ...Object.entries(fields).map(([name, value]) => ({ op: Operation.Add, path: `/fields/${name}`, value })),
        ...this.resultRelations(report, params.runId, params.resultId).map((value) => ({ op: Operation.Add, path: "/relations/-", value })),
      ];
      const bug = await witApi.createWorkItem(undefined, patch, this.config.project, "Bug");

      await this.linkTestRunToWorkItems({ runId: params.runId, resultId: params.resultId, workItemIds: [bug.id!], addRunHyperlink: false });
      return { bugId: bug.id, title: fields["System.Title"], url: bug._links?.html?.href ?? bug.url, runId: params.runId, resultId: params.resultId };
    } catch (error) {
      console.error(`Error creating bug from test result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async updateBugWithTestRun(params: UpdateBugWithTestRunParams) {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const report = await this.buildFailureReport(params.runId, params.resultId, params.additionalDetails);
      const bug = await witApi.getWorkItem(params.bugId, undefined, undefined, WorkItemExpand.All, this.config.project);

      const patch: { op: Operation; path: string; value: unknown }[] = [
        { op: Operation.Add, path: "/fields/System.History", value: report.html },
      ];
      if (params.appendToReproSteps) {
        const current = (bug.fields?.["Microsoft.VSTS.TCM.ReproSteps"] as string) || "";
        patch.push({ op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: `${current}<hr/>${report.html}` });
      }
      const existing = bug.relations || [];
      for (const relation of this.resultRelations(report, params.runId, params.resultId)) {
        const duplicate = existing.some((r) =>
          r.rel === relation.rel && (relation.rel === "Hyperlink" ? sameRunLink(r.url, relation.url) : r.url === relation.url));
        if (!duplicate) {
          patch.push({ op: Operation.Add, path: "/relations/-", value: relation });
        }
      }
      await witApi.updateWorkItem(undefined, patch, params.bugId, this.config.project);

      await this.linkTestRunToWorkItems({ runId: params.runId, resultId: params.resultId, workItemIds: [params.bugId], addRunHyperlink: false });
      return { bugId: params.bugId, runId: params.runId, resultId: params.resultId, appendedToReproSteps: !!params.appendToReproSteps };
    } catch (error) {
      console.error(`Error updating bug ${params.bugId} with test result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

}
