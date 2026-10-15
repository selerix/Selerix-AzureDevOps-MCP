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
  TestPoint as TestPlanPoint,
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
// Runs looked up at the same time when enriching a history response.
const RUN_LOOKUP_CONCURRENCY = 5;
// Pages of test points read for one suite before giving up (Azure DevOps pages them).
const MAX_POINT_PAGES = 50;
// Test results are paged with skip/top: results per request, and requests before giving up.
const RESULT_PAGE_SIZE = 500;
// Azure DevOps allows at most 200 results per request when details (work items, iterations...) are asked for.
const RESULT_PAGE_SIZE_WITH_DETAILS = 200;
const MAX_RESULT_PAGES = 200;
// Results updated per request when linking a whole run to work items.
const RESULT_UPDATE_BATCH_SIZE = 50;
// Teams, and members of a team, read per request when looking a person up (paged with top/skip).
// Results asked of the history query for one test case before giving up on filling every point.
const MAX_HISTORY_RESULTS = 1000;
// Attempts at updating a bug that someone else keeps changing underneath the update.
const MAX_BUG_UPDATE_ATTEMPTS = 3;
const IDENTITY_PAGE_SIZE = 100;
// Pages read at most, for teams and for each team's members, before concluding nobody matches.
const MAX_IDENTITY_PAGES = 100;
// How long the project's resolution states are reused while updating many results.
const RESOLUTION_STATES_TTL_MS = 60 * 1000;
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

/**
 * True when two hyperlinks are the same, or are two views of the same test run: same site, same
 * page (ignoring case and a trailing slash), same complete run id. Other query parameters, such as
 * the view (_a=runCharts / resultSummary), are ignored. The run id alone is not enough - run 77
 * of another organization or project, or of an unrelated site, is a different run.
 */
function sameRunLink(a: string | undefined, b: string): boolean {
  if (!a) {
    return false;
  }
  if (a === b) {
    return true;
  }
  try {
    const first = new URL(a);
    const second = new URL(b);
    const runOf = (url: URL) => [...url.searchParams].find(([key]) => key.toLowerCase() === "runid")?.[1];
    const runId = runOf(first);
    const page = (url: URL) => url.pathname.replace(/\/+$/, "").toLowerCase();
    return (
      runId !== undefined &&
      runId === runOf(second) &&
      first.origin.toLowerCase() === second.origin.toLowerCase() &&
      page(first) === page(second)
    );
  } catch {
    return false; // not both absolute URLs, so only an exact match counts
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once, keeping the order of the results. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * The bugs of a history result. When its run could not be read, an empty list would claim "no
 * bugs" for a result whose bugs are simply unknown, so only what the query itself reported is
 * returned, and nothing at all when that is empty.
 */
function bugsOf(
  runInfo: Map<number, { bugs: Map<number, number[]> }>,
  r: { id?: number; testRun?: { id?: string }; associatedBugs?: { id?: string }[] }
): number[] | undefined {
  const info = runInfo.get(Number(r.testRun?.id));
  const merged = mergeBugIds(info?.bugs.get(r.id!), r.associatedBugs);
  return info || merged.length > 0 ? merged : undefined;
}

/**
 * True when a work item update failed because the item changed since it was read: the update
 * carries a test of the item's revision, and Azure DevOps rejects it when the revision moved on.
 */
function isRevisionConflict(error: unknown): boolean {
  const e = error as { statusCode?: number; message?: string };
  return (
    e?.statusCode === 409 ||
    e?.statusCode === 412 ||
    /TF26071|changed by someone else|test operation|precondition|conflict/i.test(e?.message ?? "")
  );
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
  /**
   * Read every page of a suite's test points, optionally only those of the given test cases.
   * Azure DevOps returns points in pages with a continuation token; stops after MAX_POINT_PAGES
   * pages and says so rather than looping forever.
   */
  private async getAllPoints(planId: number, suiteId: number, testCaseIds: number[] | undefined, includeDetails: boolean) {
    const testPlanApi = await this.getTestPlanApi();
    const points: TestPlanPoint[] = [];
    let continuationToken: string | undefined;
    let pages = 0;
    do {
      const page = await testPlanApi.getPointsList(
        this.config.project, planId, suiteId, undefined,
        testCaseIds && testCaseIds.length ? testCaseIds.join(",") : undefined,
        continuationToken, undefined, includeDetails, false
      );
      points.push(...(page || []));
      continuationToken = page?.continuationToken || undefined;
      pages += 1;
    } while (continuationToken && pages < MAX_POINT_PAGES);
    return { points, truncated: !!continuationToken };
  }

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
    const bySuite = await this.groupTestCasesBySuite(planId, testCaseIds, suiteId);

    const points = new Map<number, ResolvedTestPoint>();
    for (const [suite, caseIds] of bySuite) {
      const { points: suitePoints, truncated } = await this.getAllPoints(planId, suite, caseIds, false);
      if (truncated) {
        // These points feed operations that change data (start a run, assign, reset), so a partial
        // list must not be used silently.
        throw new Error(
          `Suite ${suite} has more than ${MAX_POINT_PAGES} pages of test points for these test cases; narrow the request to fewer test cases`
        );
      }
      for (const point of suitePoints) {
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
      const build = await buildApi.getBuild(this.config.project, buildId);
      // A build id is global, so it must be checked against the pipeline the release artifact is
      // fed by; otherwise another pipeline's build would be bound to that artifact.
      const buildPipelineId = build?.definition?.id;
      if (buildPipelineId !== pipelineId) {
        throw new Error(
          buildPipelineId === undefined
            ? `Could not confirm that build ${buildId} belongs to build pipeline ${pipelineId}`
            : `Build ${buildId} belongs to build pipeline ${buildPipelineId}, not ${pipelineId}`
        );
      }
      return build;
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
      // Everything that can be checked without side effects is checked before the run exists, so an
      // unknown stage, a missing build or an unreachable release service leaves nothing behind.
      const releasePlan = automated ? await this.prepareRelease(params) : undefined;
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
        release = await this.startReleaseStage(run.id!, releasePlan!);
      }

      let results: TestCaseResult[] = [];
      if (!automated) {
        try {
          results = await this.getAllRunResults(run.id!);
        } catch (error) {
          // The run exists now. Reporting only this error would hide its id, and starting again to
          // retry would leave a second run behind.
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Test run ${run.id} was created but its results could not be read: ${reason}. ` +
              `Do not start the run again; read its results with getTestRuns (runId ${run.id}).`
          );
        }
      }
      const pointsByCase = new Map<number, number[]>();
      for (const p of points) {
        pointsByCase.set(p.testCaseId, [...(pointsByCase.get(p.testCaseId) || []), p.pointId]);
      }
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
          // A test case can have several points (configurations, suites): trust the result's own point,
          // and only infer from the test case when it has exactly one.
          pointId: r.testPoint?.id !== undefined
            ? Number(r.testPoint.id)
            : pointsByCase.get(Number(r.testCase?.id))?.length === 1 ? pointsByCase.get(Number(r.testCase?.id))![0] : undefined,
          outcome: r.outcome,
          state: r.state,
        })) as StartedTestResult[],
      };
    } catch (error) {
      console.error("Error starting test run:", error);
      throw error;
    }
  }

  /**
   * Check everything an automated run needs from the release side - the release pipeline, the
   * stage, the build artifact and the build - without changing anything.
   */
  private async prepareRelease(params: StartTestRunParams) {
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

    // The release is created with the chosen build as the version of one artifact, so that artifact
    // must be a Build artifact fed by the requested build pipeline. Anything else would bind the
    // build to an incompatible source, so it is rejected (before any run exists) rather than guessed.
    const artifacts = definition.artifacts || [];
    const isBuildOfPipeline = (a: (typeof artifacts)[number]) =>
      a.type === "Build" && Number(a.definitionReference?.definition?.id) === params.buildPipelineId;
    const describe = (a: (typeof artifacts)[number]) =>
      `${a.alias} (${a.type}${a.definitionReference?.definition?.name ? `, ${a.definitionReference.definition.name}` : ""})`;
    const available = artifacts.map(describe).join(", ") || "none";

    let artifact: (typeof artifacts)[number];
    if (params.artifactAlias) {
      const byAlias = artifacts.find((a) => a.alias === params.artifactAlias);
      if (!byAlias) {
        throw new Error(`Release pipeline ${params.releasePipelineId} has no artifact '${params.artifactAlias}'. Artifacts: ${available}`);
      }
      if (!isBuildOfPipeline(byAlias)) {
        throw new Error(
          `Artifact '${params.artifactAlias}' is not a Build artifact of build pipeline ${params.buildPipelineId}. Artifacts: ${available}`
        );
      }
      artifact = byAlias;
    } else {
      const matching = artifacts.filter(isBuildOfPipeline);
      if (matching.length === 0) {
        throw new Error(
          `Release pipeline ${params.releasePipelineId} has no Build artifact from build pipeline ${params.buildPipelineId}. Artifacts: ${available}`
        );
      }
      if (matching.length > 1) {
        throw new Error(
          `Release pipeline ${params.releasePipelineId} has several Build artifacts from build pipeline ${params.buildPipelineId} ` +
            `(${matching.map((a) => a.alias).join(", ")}); pass artifactAlias to choose one`
        );
      }
      artifact = matching[0];
    }

    const build = await this.resolveBuild(params.buildPipelineId!, params.buildId, params.buildNumber);
    return {
      releaseApi,
      definitionId: params.releasePipelineId!,
      environments,
      stage: { id: stage.id, name: stage.name! },
      artifactAlias: artifact.alias,
      build: { id: build.id!, number: build.buildNumber },
      variableName: params.runIdVariableName || "test.RunId",
    };
  }

  /**
   * Create the release for an already created test run and start only the chosen stage. A failure
   * names what exists so it can be recovered: before a release exists the run is marked Aborted
   * (nothing ran, so that is safe); once a release exists nothing is undone.
   */
  private async startReleaseStage(runId: number, plan: Awaited<ReturnType<TestExecutionService["prepareRelease"]>>) {
    const testApi = await this.getTestApi();
    let releaseId: number | undefined;
    let step = "create the release";
    try {
      const release = await plan.releaseApi.createRelease(
        {
          definitionId: plan.definitionId,
          description: `Test run ${runId}`,
          artifacts: [{ alias: plan.artifactAlias, instanceReference: { id: String(plan.build.id), name: plan.build.number } }],
          // Every stage is manual so creating the release deploys nothing; the chosen one is started below.
          manualEnvironments: plan.environments.map((e) => e.name!),
          variables: { [plan.variableName]: { value: String(runId) } },
        },
        this.config.project
      );
      releaseId = release.id;

      step = "start the stage";
      const releaseEnvironment = (release.environments || []).find((e) => e.definitionEnvironmentId === plan.stage.id);
      if (!releaseEnvironment?.id) {
        throw new Error(`stage '${plan.stage.name}' was not found on the new release`);
      }
      await plan.releaseApi.updateReleaseEnvironment(
        { status: EnvironmentStatus.InProgress, comment: `Started by test run ${runId}` },
        this.config.project,
        release.id!,
        releaseEnvironment.id
      );

      step = "link the release to the test run";
      await testApi.updateTestRun(
        {
          releaseUri: `vstfs:///ReleaseManagement/Release/${release.id}`,
          releaseEnvironmentUri: `vstfs:///ReleaseManagement/Environment/${releaseEnvironment.id}`,
          build: { id: String(plan.build.id) },
        },
        this.config.project,
        runId
      );

      return { id: release.id, name: release.name, stage: plan.stage.name };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (releaseId === undefined) {
        let outcome: string;
        try {
          await testApi.updateTestRun({ state: "Aborted", comment: `Release could not be created: ${reason}` }, this.config.project, runId);
          outcome = `Test run ${runId} was marked Aborted.`;
        } catch {
          outcome = `Test run ${runId} was created and could not be aborted; abort it manually.`;
        }
        throw new Error(`Could not ${step} for test run ${runId}: ${reason}. ${outcome}`);
      }
      throw new Error(
        `Release ${releaseId} was created for test run ${runId} but could not ${step}: ${reason}. ` +
          `Nothing was undone; test run ${runId} is still NotStarted.`
      );
    }
  }

  /**
   * Parse a steps field and expand each shared-step reference into the reference row followed by
   * the steps of the shared set, with paths and identifiers as the web UI records them
   * (child path = parent path + child path, identifier "parent;child").
   */
  protected async expandSteps(stepsXml: string | undefined, sharedRevisions?: Map<number, number>): Promise<ParsedTestStep[]> {
    const rows = parseTestSteps(stepsXml);
    if (!rows.some((r) => r.type === "SharedStepReference")) {
      return rows;
    }
    const expanded: ParsedTestStep[] = [];
    for (const row of rows) {
      if (row.type !== "SharedStepReference") {
        expanded.push(row);
        continue;
      }
      const shared = await this.getWorkItemAtRevision(
        row.sharedStepId!,
        sharedRevisions?.get(row.sharedStepId!),
        ["Microsoft.VSTS.TCM.Steps", "System.Title"]
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

  /**
   * Read a work item as it was at a revision, so a result is shown against the steps that were
   * actually run. Falls back to the latest version when no revision is known or it can't be read.
   */
  protected async getWorkItemAtRevision(id: number, revision: number | undefined, fields: string[]) {
    const witApi = await this.getWorkItemTrackingApi();
    if (revision) {
      try {
        return await witApi.getRevision(id, revision, undefined, this.config.project);
      } catch {
        // an unreadable revision falls back to the latest
      }
    }
    return await witApi.getWorkItem(id, fields, undefined, undefined, this.config.project);
  }

  /** Fetch a test case's steps (shared steps expanded), at a revision when one is given. */
  protected async getTestCaseSteps(
    testCaseId: number,
    revision?: number,
    sharedRevisions?: Map<number, number>
  ): Promise<ParsedTestStep[]> {
    const workItem = await this.getWorkItemAtRevision(testCaseId, revision, ["Microsoft.VSTS.TCM.Steps"]);
    return await this.expandSteps(workItem?.fields?.["Microsoft.VSTS.TCM.Steps"], sharedRevisions);
  }

  /**
   * The steps a result was run against: its test case at the revision it recorded, with each
   * shared step set at the revision recorded on the reference row. A test case or shared set
   * edited after the run would otherwise show outcomes against instructions never executed, and
   * step updates and attachments could resolve to the wrong step.
   */
  protected async getStepsForResult(result: TestCaseResult): Promise<ParsedTestStep[]> {
    const recorded = result.iterationDetails?.[0]?.actionResults || [];
    const sharedRevisions = new Map<number, number>();
    for (const a of recorded) {
      if (a.sharedStepModel?.id && a.sharedStepModel.revision) {
        sharedRevisions.set(a.sharedStepModel.id, a.sharedStepModel.revision);
      }
    }
    return await this.getTestCaseSteps(Number(result.testCase?.id), result.testCaseRevision, sharedRevisions);
  }

  /**
   * Read every result of a run. Results come back in pages (skip/top), so one call is only the
   * first page of a large run.
   */
  protected async getAllRunResults(runId: number, details?: ResultDetails): Promise<TestCaseResult[]> {
    const testApi = await this.getTestApi();
    const all: TestCaseResult[] = [];
    // The page size has to match what the server will actually return: a request for more than the
    // limit is rejected or silently cut short, and a short page would then look like the last one.
    const pageSize = details ? RESULT_PAGE_SIZE_WITH_DETAILS : RESULT_PAGE_SIZE;
    for (let page = 0; page < MAX_RESULT_PAGES; page++) {
      const batch = (await testApi.getTestResults(this.config.project, runId, details, all.length, pageSize)) || [];
      all.push(...batch);
      if (batch.length < pageSize) {
        return all;
      }
    }
    throw new Error(`Test run ${runId} has more than ${MAX_RESULT_PAGES * pageSize} results; too many to read at once`);
  }

  // Tail of the queue of operations on each result, keyed "runId/resultId".
  private resultLocks = new Map<string, Promise<void>>();

  /**
   * Run `fn` while holding the lock of each given result, so the read-merge-write cycles of
   * operations on the same result run one after another instead of overwriting each other (two
   * comments appended from the same starting text, step outcomes resent from before another edit,
   * analysis or owner values resent stale). Operations on different results do not wait for each
   * other. Locks are taken in ascending order, so overlapping batches cannot deadlock. This
   * serialises calls within this server process only; it cannot see edits made elsewhere.
   */
  protected async withResultLocks<T>(runId: number, resultIds: number[], fn: () => Promise<T>): Promise<T> {
    const keys = [...new Set(resultIds)].sort((a, b) => a - b).map((id) => `${runId}/${id}`);
    const releases: (() => void)[] = [];
    try {
      for (const key of keys) {
        const previous = this.resultLocks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>((resolve) => (release = resolve));
        const tail = previous.then(() => mine);
        this.resultLocks.set(key, tail);
        releases.push(() => {
          release();
          if (this.resultLocks.get(key) === tail) {
            this.resultLocks.delete(key);
          }
        });
        await previous;
      }
      return await fn();
    } finally {
      releases.forEach((r) => r());
    }
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
        const testCaseSteps = await this.getStepsForResult(result);
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
    return await this.withResultLocks(params.runId, [params.resultId], () => this.setTestStepResultsExclusive(params));
  }

  private async setTestStepResultsExclusive(params: SetTestStepResultsParams) {
    try {
      if ((!params.steps || params.steps.length === 0) && !params.allStepsOutcome) {
        throw new Error("Provide steps and/or allStepsOutcome");
      }
      const testApi = await this.getTestApi();
      const result = await this.getResultWithIterations(params.runId, params.resultId);
      if (!result.testCase?.id) {
        throw new Error(`Result ${params.resultId} has no test case`);
      }
      const steps = await this.getStepsForResult(result);
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
    return await this.withResultLocks(params.runId, [params.resultId], () => this.setTestResultOutcomeExclusive(params));
  }

  private async setTestResultOutcomeExclusive(params: SetTestResultOutcomeParams) {
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
      // the same limit as a file: the decoded size, checked before the request body is built
      const decodedBytes = Buffer.byteLength(params.base64Content, "base64");
      if (decodedBytes > MAX_TEST_ATTACHMENT_BYTES) {
        throw new Error(`Content is ${Math.round(decodedBytes / 1048576)} MB; the limit is ${MAX_TEST_ATTACHMENT_BYTES / 1048576} MB`);
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
        const step = (await this.getStepsForResult(result)).find((s) => s.identifier === String(params.stepId));
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
    return await this.withResultLocks(params.runId, [params.resultId], () => this.addTestResultCommentExclusive(params));
  }

  private async addTestResultCommentExclusive(params: AddTestResultCommentParams) {
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
  private resolutionStatesCache?: { at: number; states: { id: number; name: string }[] };

  /** The project's resolution states, reused briefly so updating many results is not one lookup each. */
  private async getResolutionStatesCached() {
    if (this.resolutionStatesCache && Date.now() - this.resolutionStatesCache.at < RESOLUTION_STATES_TTL_MS) {
      return this.resolutionStatesCache.states;
    }
    const states = await this.listTestResolutionStates();
    this.resolutionStatesCache = { at: Date.now(), states };
    return states;
  }

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
    // A resolution supplied by the caller replaces the current one, so the current one is not even
    // looked up (that lookup needs the resolution-state route, which may be unavailable).
    if (patch.resolutionStateId === undefined) {
      let resolutionStateId = existing.resolutionStateId;
      if (!resolutionStateId && existing.resolutionState) {
        const states = await this.getResolutionStatesCached();
        resolutionStateId = states.find((st) => st.name.toLowerCase() === existing.resolutionState!.toLowerCase())?.id;
      }
      if (resolutionStateId) {
        update.resolutionStateId = resolutionStateId;
      }
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
    return await this.withResultLocks(params.runId, [params.resultId], () => this.updateTestResultAnalysisExclusive(params));
  }

  private async updateTestResultAnalysisExclusive(params: UpdateTestResultAnalysisParams) {
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
    // Teams and each team's members are both paged (top/skip), so every page is read before
    // concluding the person is absent. A page that adds nothing new ends the loop, in case a
    // server ignores skip and keeps returning the same page.
    const seenTeams = new Set<string>();
    for (let teamPage = 0; teamPage < MAX_IDENTITY_PAGES; teamPage++) {
      const teams = (await coreApi.getTeams(this.config.project, false, IDENTITY_PAGE_SIZE, teamPage * IDENTITY_PAGE_SIZE)) || [];
      const newTeams = teams.filter((t) => {
        if (!t.id || seenTeams.has(t.id)) return false;
        seenTeams.add(t.id);
        return true;
      });

      for (const team of newTeams) {
        const seenMembers = new Set<string>();
        for (let memberPage = 0; memberPage < MAX_IDENTITY_PAGES; memberPage++) {
          const members =
            (await coreApi.getTeamMembersWithExtendedProperties(
              this.config.project, team.id!, IDENTITY_PAGE_SIZE, memberPage * IDENTITY_PAGE_SIZE
            )) || [];
          const match = members.find(
            (m) => m.identity?.uniqueName?.toLowerCase() === needle || m.identity?.displayName?.toLowerCase() === needle
          );
          if (match?.identity?.id) {
            return { id: match.identity.id, uniqueName: match.identity.uniqueName, displayName: match.identity.displayName };
          }
          const newMembers = members.filter((m) => {
            const id = m.identity?.id;
            if (!id || seenMembers.has(id)) return false;
            seenMembers.add(id);
            return true;
          });
          if (members.length < IDENTITY_PAGE_SIZE || newMembers.length === 0) {
            break;
          }
        }
      }
      if (teams.length < IDENTITY_PAGE_SIZE || newTeams.length === 0) {
        break;
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
        const results = await this.getAllRunResults(params.runId);
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
   * returns neither (names blank, bugs empty), so both come from the run itself. Every run is
   * looked up, a few at a time. A run that can't be read is left out of the result, so callers
   * can tell "no bugs" from "not looked up".
   */
  protected async getRunInfo(runIds: number[]): Promise<Map<number, { name?: string; bugs: Map<number, number[]> }>> {
    const info = new Map<number, { name?: string; bugs: Map<number, number[]> }>();
    const distinct = [...new Set(runIds.filter((id) => Number.isFinite(id)))];
    const testApi = await this.getTestApi();
    await mapWithConcurrency(distinct, RUN_LOOKUP_CONCURRENCY, async (id) => {
      try {
        const run = await testApi.getTestRunById(this.config.project, id);
        const results = await this.getAllRunResults(id, ResultDetails.WorkItems);
        const bugs = new Map<number, number[]>();
        for (const r of results || []) {
          if (r.id !== undefined && r.associatedBugs?.length) {
            bugs.set(r.id, r.associatedBugs.map((b) => Number(b.id)));
          }
        }
        info.set(id, { name: run?.name || undefined, bugs });
      } catch {
        // left out: the caller reports it as not looked up
      }
    });
    return info;
  }

  /**
   * The recent results of a test case, enough to give each of the given points up to `top` of them.
   * The query's limit applies to the whole test case, across all of its points, before any grouping
   * by point - so one busy configuration can use it all up and hide another's older results. The
   * query is therefore widened until every point has `top` results or the test case's results run
   * out, up to MAX_HISTORY_RESULTS; points still short at that cap are reported as incomplete.
   */
  private async getResultsForPoints(testCaseId: number, planId: number, pointIds: number[], top: number) {
    const testApi = await this.getTestApi();
    let count = Math.min(Math.max(25, top * 5), MAX_HISTORY_RESULTS);
    for (;;) {
      const response = await testApi.getTestResultsByQuery(
        { resultsFilter: { automatedTestName: "", testCaseId, testPlanId: planId, resultsCount: count } },
        this.config.project
      );
      const results = response?.results || [];
      const perPoint = new Map<number, number>();
      for (const r of results) {
        const pointId = Number(r.testPoint?.id);
        perPoint.set(pointId, (perPoint.get(pointId) ?? 0) + 1);
      }
      const short = pointIds.filter((id) => (perPoint.get(id) ?? 0) < top);
      if (short.length === 0 || results.length < count) {
        return { results, incompletePointIds: [] as number[] }; // filled, or every result has been read
      }
      if (count >= MAX_HISTORY_RESULTS) {
        return { results, incompletePointIds: short };
      }
      count = Math.min(count * 2, MAX_HISTORY_RESULTS);
    }
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
      const bySuite = hasCases
        ? await this.groupTestCasesBySuite(params.planId, params.testCaseIds!, params.suiteId)
        : new Map<number, number[]>([[params.suiteId!, []]]);

      const points = [];
      let moreAvailable = false;
      for (const [suiteId, caseIds] of bySuite) {
        // every page is read before the points are mapped and filtered
        const { points: suitePoints, truncated } = await this.getAllPoints(params.planId, suiteId, caseIds, true);
        moreAvailable = moreAvailable || truncated;
        for (const p of suitePoints) {
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
      const historyRunsNotLookedUp: number[] = [];
      const historyIncompleteForPoints: number[] = [];
      if (params.includeHistory && shown.length > 0) {
        try {
          const testApi = await this.getTestApi();
          const top = params.historyTop ?? 10;
          // Querying by test point id only returns each point's latest result, so query by test
          // case (all of its results across runs) and group the results by the point they ran.
          const results = [];
          for (const testCaseId of new Set(shown.map((p) => p.testCaseId!))) {
            const pointIds = shown.filter((p) => p.testCaseId === testCaseId).map((p) => p.pointId);
            const found = await this.getResultsForPoints(testCaseId, params.planId, pointIds, top);
            results.push(...found.results);
            historyIncompleteForPoints.push(...found.incompletePointIds);
          }
          // Pick what is shown first - the requested points' results, at most `top` each - and only
          // then look up run names and bugs, so the lookups (each pages through a run's results)
          // are spent on entries that are returned, not on the other points' results the query
          // also brought back.
          const retained = new Map<number, typeof results>(shown.map((p) => [p.pointId, []]));
          for (const r of results) {
            const list = retained.get(Number(r.testPoint?.id));
            if (list && list.length < top) {
              list.push(r);
            }
          }
          const retainedResults = [...retained.values()].flat();
          const runInfo = await this.getRunInfo(retainedResults.map((r) => Number(r.testRun?.id)));
          historyRunsNotLookedUp.push(
            ...[...new Set(retainedResults.map((r) => Number(r.testRun?.id)))].filter((id) => Number.isFinite(id) && !runInfo.has(id))
          );
          history = Object.fromEntries(
            [...retained].map(([pointId, list]) => [
              pointId,
              list.map((r) => ({
                runId: r.testRun?.id ? Number(r.testRun.id) : undefined,
                runName: runInfo.get(Number(r.testRun?.id))?.name || undefined,
                resultId: r.id,
                outcome: r.outcome,
                runBy: r.runBy?.displayName,
                completedDate: r.completedDate,
                associatedBugs: bugsOf(runInfo, r),
              })),
            ])
          );
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
        historyRunsNotLookedUp: historyRunsNotLookedUp.length ? historyRunsNotLookedUp : undefined,
        // points whose history may be longer than shown: the retrieval cap was reached before they had enough results
        historyIncompleteForPoints: historyIncompleteForPoints.length ? historyIncompleteForPoints : undefined,
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
      const notEnriched = [...new Set(results.map((r) => Number(r.testRun?.id)))].filter((id) => Number.isFinite(id) && !runInfo.has(id));
      return {
        testCaseId: params.testCaseId,
        count: results.length,
        // runs that could not be read: their names and bugs are unknown, not empty
        runsNotLookedUp: notEnriched.length ? notEnriched : undefined,
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
          associatedBugs: bugsOf(runInfo, r),
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

      // Which results: the one given, or every result of the run (read page by page).
      const resultIds: number[] =
        params.resultId !== undefined
          ? [params.resultId]
          : (await this.getAllRunResults(params.runId)).map((r) => r.id!);

      // associatedBugs replaces the list, so each result's current bugs are read and merged. That
      // read-merge-write is done under the results' locks, a bounded batch at a time, so neither a
      // large run in one huge request nor a concurrent edit can lose an update.
      for (let i = 0; i < resultIds.length; i += RESULT_UPDATE_BATCH_SIZE) {
        const batch = resultIds.slice(i, i + RESULT_UPDATE_BATCH_SIZE);
        await this.withResultLocks(params.runId, batch, async () => {
          const existingResults = await mapWithConcurrency(batch, RUN_LOOKUP_CONCURRENCY, (id) =>
            testApi.getTestResultById(this.config.project, params.runId, id, ResultDetails.WorkItems)
          );
          const updates: TestCaseResult[] = [];
          for (let j = 0; j < batch.length; j++) {
            const ids = new Set((existingResults[j].associatedBugs || []).map((b) => String(b.id)));
            params.workItemIds.forEach((id) => ids.add(String(id)));
            updates.push(
              await this.buildResultUpdate(existingResults[j], { id: batch[j], associatedBugs: [...ids].map((id) => ({ id })) })
            );
          }
          await testApi.updateTestResults(updates, this.config.project, params.runId);
        });
      }

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
    const steps = await this.getStepsForResult(result);
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

      const url = bug._links?.html?.href ?? bug.url;
      try {
        await this.linkTestRunToWorkItems({ runId: params.runId, resultId: params.resultId, workItemIds: [bug.id!], addRunHyperlink: false });
      } catch (error) {
        // The bug exists now. Reporting only the linking error would hide its id, and creating the
        // bug again to retry would leave a duplicate.
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Bug ${bug.id} was created (${url}) but could not be linked to test result ${params.runId}/${params.resultId}: ${reason}. ` +
            `Do not create the bug again; retry linkTestRunToWorkItems with runId ${params.runId}, resultId ${params.resultId} and workItemIds [${bug.id}].`
        );
      }
      return { bugId: bug.id, title: fields["System.Title"], url, runId: params.runId, resultId: params.resultId };
    } catch (error) {
      console.error(`Error creating bug from test result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

  public async updateBugWithTestRun(params: UpdateBugWithTestRunParams) {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const report = await this.buildFailureReport(params.runId, params.resultId, params.additionalDetails);
      // The Repro Steps text is read, extended and written back, so two updates overlapping on one
      // bug could overwrite each other's report. The update therefore carries a test of the revision
      // it was built from: if the bug has changed since, Azure DevOps rejects it, and it is rebuilt
      // from a fresh read instead of silently replacing the newer text.
      for (let attempt = 1; ; attempt++) {
        const bug = await witApi.getWorkItem(params.bugId, undefined, undefined, WorkItemExpand.All, this.config.project);

        const patch: { op: Operation; path: string; value: unknown }[] = [
          { op: Operation.Test, path: "/rev", value: bug.rev },
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

        try {
          await witApi.updateWorkItem(undefined, patch, params.bugId, this.config.project);
          break;
        } catch (error) {
          if (!isRevisionConflict(error)) {
            throw error;
          }
          if (attempt >= MAX_BUG_UPDATE_ATTEMPTS) {
            throw new Error(
              `Bug ${params.bugId} kept changing while it was being updated (${attempt} attempts), so nothing was added. Try again.`
            );
          }
        }
      }

      try {
        await this.linkTestRunToWorkItems({ runId: params.runId, resultId: params.resultId, workItemIds: [params.bugId], addRunHyperlink: false });
      } catch (error) {
        // The bug has already been updated. Calling this tool again would add the comment twice.
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Bug ${params.bugId} was updated with test result ${params.runId}/${params.resultId} but the result could not be linked to it: ${reason}. ` +
            `Do not call updateBugWithTestRun again (it would repeat the comment); retry linkTestRunToWorkItems with runId ${params.runId}, ` +
            `resultId ${params.resultId} and workItemIds [${params.bugId}].`
        );
      }
      return { bugId: params.bugId, runId: params.runId, resultId: params.resultId, appendedToReproSteps: !!params.appendToReproSteps };
    } catch (error) {
      console.error(`Error updating bug ${params.bugId} with test result ${params.runId}/${params.resultId}:`, error);
      throw error;
    }
  }

}
