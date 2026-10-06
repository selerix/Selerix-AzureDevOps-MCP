import { randomUUID } from "crypto";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { ITestApi } from "azure-devops-node-api/TestApi";
import * as BuildInterfaces from "azure-devops-node-api/interfaces/BuildInterfaces";
import * as TestInterfaces from "azure-devops-node-api/interfaces/TestInterfaces";
import * as WitInterfaces from "azure-devops-node-api/interfaces/WorkItemTrackingInterfaces";
import {
  JsonPatchOperation,
  Operation,
  PagedList,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import { downloadStreamToFile } from "../utils/downloadStreamToFile";
import {
  ListPipelinesParams,
  GetPipelineDetailsParams,
  UpdatePipelineVariablesParams,
  ScheduleBuildParams,
  ListBuildsParams,
  GetBuildDetailsParams,
  CancelBuildParams,
  GetBuildTestResultsParams,
  GetBuildLogsParams,
  GetBuildArtifactsParams,
  AssociateAutomatedTestWithTestCaseParams,
  TestOutcomeFilter,
} from "../Interfaces/Pipelines";

const BUILD_STATUS_MAP: Record<string, BuildInterfaces.BuildStatus> = {
  none: BuildInterfaces.BuildStatus.None,
  inProgress: BuildInterfaces.BuildStatus.InProgress,
  completed: BuildInterfaces.BuildStatus.Completed,
  cancelling: BuildInterfaces.BuildStatus.Cancelling,
  postponed: BuildInterfaces.BuildStatus.Postponed,
  notStarted: BuildInterfaces.BuildStatus.NotStarted,
  all: BuildInterfaces.BuildStatus.All,
};

const BUILD_RESULT_MAP: Record<string, BuildInterfaces.BuildResult> = {
  none: BuildInterfaces.BuildResult.None,
  succeeded: BuildInterfaces.BuildResult.Succeeded,
  partiallySucceeded: BuildInterfaces.BuildResult.PartiallySucceeded,
  failed: BuildInterfaces.BuildResult.Failed,
  canceled: BuildInterfaces.BuildResult.Canceled,
};

const BUILD_QUERY_ORDER_MAP: Record<string, BuildInterfaces.BuildQueryOrder> = {
  finishTimeAscending: BuildInterfaces.BuildQueryOrder.FinishTimeAscending,
  finishTimeDescending: BuildInterfaces.BuildQueryOrder.FinishTimeDescending,
  queueTimeAscending: BuildInterfaces.BuildQueryOrder.QueueTimeAscending,
  queueTimeDescending: BuildInterfaces.BuildQueryOrder.QueueTimeDescending,
  startTimeAscending: BuildInterfaces.BuildQueryOrder.StartTimeAscending,
  startTimeDescending: BuildInterfaces.BuildQueryOrder.StartTimeDescending,
};

const TEST_OUTCOME_MAP: Record<TestOutcomeFilter, TestInterfaces.TestOutcome> = {
  none: TestInterfaces.TestOutcome.None,
  passed: TestInterfaces.TestOutcome.Passed,
  failed: TestInterfaces.TestOutcome.Failed,
  inconclusive: TestInterfaces.TestOutcome.Inconclusive,
  timeout: TestInterfaces.TestOutcome.Timeout,
  aborted: TestInterfaces.TestOutcome.Aborted,
  blocked: TestInterfaces.TestOutcome.Blocked,
  notExecuted: TestInterfaces.TestOutcome.NotExecuted,
  warning: TestInterfaces.TestOutcome.Warning,
  error: TestInterfaces.TestOutcome.Error,
  notApplicable: TestInterfaces.TestOutcome.NotApplicable,
  paused: TestInterfaces.TestOutcome.Paused,
  inProgress: TestInterfaces.TestOutcome.InProgress,
  notImpacted: TestInterfaces.TestOutcome.NotImpacted,
};

const DEFAULT_AUTOMATED_TEST_TYPE = "Unit Test";

export class PipelinesService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  private async getBuildApi(): Promise<IBuildApi> {
    return await this.connection.getBuildApi();
  }

  private async getTestApi(): Promise<ITestApi> {
    return await this.connection.getTestApi();
  }

  /**
   * getTestResultsByBuild is paged (VSSInterfaces.PagedList, via a continuationToken) - a single
   * call only returns the server's first page. Callers that need the complete result set (rather
   * than an explicit, caller-bounded `top`) must follow the continuation token until it's
   * exhausted, or a build with more published results than one page silently looks smaller than
   * it is. Capped at 20 pages as a safety bound against an unbounded loop if the API ever returned
   * a non-terminating continuation token.
   */
  private async getAllTestResultsByBuild(
    buildId: number,
    outcomes?: TestInterfaces.TestOutcome[]
  ): Promise<TestInterfaces.ShallowTestCaseResult[]> {
    const all: TestInterfaces.ShallowTestCaseResult[] = [];
    const testApi = await this.getTestApi();
    let continuationToken: string | undefined;
    let pages = 0;
    const MAX_PAGES = 20;

    do {
      const page: PagedList<TestInterfaces.ShallowTestCaseResult> =
        await testApi.getTestResultsByBuild(this.config.project, buildId, undefined, outcomes, undefined, continuationToken);
      all.push(...page);
      continuationToken = page.continuationToken;
      pages += 1;
    } while (continuationToken && pages < MAX_PAGES);

    return all;
  }

  // ----- Pipelines / build definitions -----

  public async listPipelines(params: ListPipelinesParams): Promise<BuildInterfaces.BuildDefinitionReference[]> {
    try {
      const buildApi = await this.getBuildApi();

      // An explicit `top` is a caller-chosen bound - honor it with a single page. Otherwise
      // follow continuation tokens so a project with more pipelines than one server page doesn't
      // come back looking like a shorter, complete list.
      if (params.top !== undefined) {
        return await buildApi.getDefinitions(
          this.config.project, params.nameFilter, undefined, undefined, undefined, params.top,
          undefined, undefined, undefined, params.path
        );
      }

      const all: BuildInterfaces.BuildDefinitionReference[] = [];
      let continuationToken: string | undefined;
      let pages = 0;
      const MAX_PAGES = 20;
      do {
        const page: PagedList<BuildInterfaces.BuildDefinitionReference> = await buildApi.getDefinitions(
          this.config.project, params.nameFilter, undefined, undefined, undefined, undefined,
          continuationToken, undefined, undefined, params.path
        );
        all.push(...page);
        continuationToken = page.continuationToken;
        pages += 1;
      } while (continuationToken && pages < MAX_PAGES);
      return all;
    } catch (error) {
      console.error("Error listing pipelines:", error);
      throw error;
    }
  }

  public async getPipelineDetails(params: GetPipelineDetailsParams): Promise<BuildInterfaces.BuildDefinition> {
    try {
      const buildApi = await this.getBuildApi();
      return await buildApi.getDefinition(this.config.project, params.pipelineId);
    } catch (error) {
      console.error(`Error getting pipeline ${params.pipelineId}:`, error);
      throw error;
    }
  }

  /**
   * Persists variable adds/edits/removals onto the pipeline definition itself (the same store
   * backing the "Variables" panel in the ADO UI, for both classic and YAML pipelines). Always
   * re-fetches the current definition first so the edit is applied against its current revision
   * rather than a possibly-stale caller-supplied copy - updateDefinition otherwise fails with a
   * revision mismatch, or worse, overwrites concurrent edits.
   */
  public async updatePipelineVariables(params: UpdatePipelineVariablesParams): Promise<BuildInterfaces.BuildDefinition> {
    try {
      const buildApi = await this.getBuildApi();
      const definition = await buildApi.getDefinition(this.config.project, params.pipelineId);

      const variables = { ...(definition.variables || {}) };

      for (const [name, edit] of Object.entries(params.variables || {})) {
        const existing = variables[name] || {};
        const isSecret = edit.isSecret !== undefined ? edit.isSecret : existing.isSecret;

        // Azure DevOps never returns a secret variable's real value from getDefinition - it
        // comes back as an empty string so the value isn't leaked. Echoing that redacted ""
        // straight back through updateDefinition would overwrite the real secret. Azure DevOps
        // only leaves an existing secret's value untouched when the field is omitted entirely
        // from the payload, so a secret variable the caller isn't explicitly setting a new
        // value for must have `value` left undefined (JSON.stringify then drops the key) rather
        // than carrying `existing.value` forward.
        const value = edit.value !== undefined ? edit.value : (isSecret ? undefined : existing.value);

        variables[name] = {
          value,
          isSecret,
          allowOverride: edit.allowOverride !== undefined ? edit.allowOverride : existing.allowOverride,
        };
      }

      for (const name of params.removeVariables || []) {
        delete variables[name];
      }

      definition.variables = variables;

      return await buildApi.updateDefinition(definition, this.config.project, params.pipelineId);
    } catch (error) {
      console.error(`Error updating variables for pipeline ${params.pipelineId}:`, error);
      throw error;
    }
  }

  // ----- Builds -----

  /**
   * Queues a new run of a pipeline. Variable overrides here are queue-time only - they are sent
   * as the classic `parameters` JSON payload, which Azure DevOps only honors for variables the
   * definition has marked settable at queue time (`allowOverride: true` in getPipelineDetails'
   * variables map). An override for a variable that isn't overridable is silently ignored by
   * Azure DevOps rather than rejected, so check getPipelineDetails first if a run doesn't pick up
   * an expected value.
   */
  public async scheduleBuild(params: ScheduleBuildParams): Promise<BuildInterfaces.Build> {
    try {
      const buildApi = await this.getBuildApi();

      const build: BuildInterfaces.Build = {
        definition: { id: params.pipelineId },
        sourceBranch: params.sourceBranch,
        parameters: params.variables ? JSON.stringify(params.variables) : undefined,
      };

      return await buildApi.queueBuild(build, this.config.project);
    } catch (error) {
      console.error(`Error scheduling build for pipeline ${params.pipelineId}:`, error);
      throw error;
    }
  }

  public async listBuilds(params: ListBuildsParams): Promise<BuildInterfaces.Build[]> {
    try {
      const buildApi = await this.getBuildApi();
      const definitions = params.pipelineId ? [params.pipelineId] : undefined;
      const minTime = params.minTime ? new Date(params.minTime) : undefined;
      const maxTime = params.maxTime ? new Date(params.maxTime) : undefined;
      const statusFilter = params.statusFilter ? BUILD_STATUS_MAP[params.statusFilter] : undefined;
      const resultFilter = params.resultFilter ? BUILD_RESULT_MAP[params.resultFilter] : undefined;
      const queryOrder = params.queryOrder ? BUILD_QUERY_ORDER_MAP[params.queryOrder] : undefined;

      // An explicit `top` is a caller-chosen bound - honor it with a single page. Otherwise
      // follow continuation tokens so a pipeline with more history than one server page doesn't
      // come back looking like a shorter, complete list.
      if (params.top !== undefined) {
        return await buildApi.getBuilds(
          this.config.project, definitions, undefined, undefined, minTime, maxTime, undefined, undefined,
          statusFilter, resultFilter, undefined, undefined, params.top, undefined, undefined, undefined,
          queryOrder, params.branchName
        );
      }

      const all: BuildInterfaces.Build[] = [];
      let continuationToken: string | undefined;
      let pages = 0;
      const MAX_PAGES = 20;
      do {
        const page: PagedList<BuildInterfaces.Build> = await buildApi.getBuilds(
          this.config.project, definitions, undefined, undefined, minTime, maxTime, undefined, undefined,
          statusFilter, resultFilter, undefined, undefined, undefined, continuationToken, undefined, undefined,
          queryOrder, params.branchName
        );
        all.push(...page);
        continuationToken = page.continuationToken;
        pages += 1;
      } while (continuationToken && pages < MAX_PAGES);
      return all;
    } catch (error) {
      console.error("Error listing builds:", error);
      throw error;
    }
  }

  public async getBuildDetails(params: GetBuildDetailsParams): Promise<BuildInterfaces.Build> {
    try {
      const buildApi = await this.getBuildApi();
      return await buildApi.getBuild(this.config.project, params.buildId);
    } catch (error) {
      console.error(`Error getting build ${params.buildId}:`, error);
      throw error;
    }
  }

  /**
   * Cancels a build that is queued (not yet started) or in progress, by asking Azure DevOps to
   * move it to the Cancelling status - the same call the "Cancel" button in the UI makes. A
   * queued build that hasn't been picked up by an agent is finalized as canceled by the server;
   * a running one is stopped by its agent, so the returned build may still report
   * status=cancelling rather than completed/canceled - re-check with getBuildDetails if needed.
   * A build that has already completed can't be cancelled, so reject that explicitly rather than
   * letting the update silently no-op.
   */
  public async cancelBuild(params: CancelBuildParams): Promise<BuildInterfaces.Build> {
    try {
      const buildApi = await this.getBuildApi();
      const existing = await buildApi.getBuild(this.config.project, params.buildId);

      if (existing.status === BuildInterfaces.BuildStatus.Completed) {
        throw new Error(
          `Build ${params.buildId} has already completed (result: ` +
          `${existing.result !== undefined ? BuildInterfaces.BuildResult[existing.result] : "unknown"}) and cannot be cancelled.`
        );
      }

      return await buildApi.updateBuild(
        { status: BuildInterfaces.BuildStatus.Cancelling } as BuildInterfaces.Build,
        this.config.project,
        params.buildId
      );
    } catch (error) {
      console.error(`Error cancelling build ${params.buildId}:`, error);
      throw error;
    }
  }

  public async getBuildTestResults(params: GetBuildTestResultsParams): Promise<TestInterfaces.ShallowTestCaseResult[]> {
    try {
      const outcomes = params.outcomeFilter?.map((o) => TEST_OUTCOME_MAP[o]);

      // An explicit `top` is a caller-chosen bound, so honor it with a single page. Otherwise
      // the caller wants "the results", not "however many fit on one server page" - follow
      // continuation tokens until exhausted so a large test suite isn't silently truncated.
      if (params.top !== undefined) {
        const testApi = await this.getTestApi();
        return await testApi.getTestResultsByBuild(this.config.project, params.buildId, undefined, outcomes, params.top);
      }

      return await this.getAllTestResultsByBuild(params.buildId, outcomes);
    } catch (error) {
      console.error(`Error getting test results for build ${params.buildId}:`, error);
      throw error;
    }
  }

  /**
   * Lists a build's logs, or downloads one (or all, zipped) to disk when savePath is given.
   * Mirrors the temp-file-then-rename pattern used for work item attachment downloads, so a
   * failed download never clobbers or leaves a truncated file at savePath.
   */
  public async getBuildLogs(
    params: GetBuildLogsParams
  ): Promise<{ logs: BuildInterfaces.BuildLog[] } | { lines: string[] } | { savePath: string; size: number }> {
    try {
      const buildApi = await this.getBuildApi();

      if (!params.savePath) {
        if (params.logId !== undefined) {
          return { lines: await buildApi.getBuildLogLines(this.config.project, params.buildId, params.logId) };
        }
        return { logs: await buildApi.getBuildLogs(this.config.project, params.buildId) };
      }

      const contentStream =
        params.logId !== undefined
          ? await buildApi.getBuildLogZip(this.config.project, params.buildId, params.logId)
          : await buildApi.getBuildLogsZip(this.config.project, params.buildId);

      return await downloadStreamToFile(contentStream, params.savePath);
    } catch (error) {
      console.error(`Error getting logs for build ${params.buildId}:`, error);
      throw error;
    }
  }

  /**
   * Lists a build's artifacts, or downloads one artifact's content zip to disk when both
   * artifactName and savePath are given. Azure DevOps has no "zip every artifact" endpoint, so
   * unlike getBuildLogs, savePath has no meaning without artifactName - rejected outright rather
   * than silently ignored, since a caller reasonably expecting a bulk download (by analogy with
   * getBuildLogs) would otherwise get an inline artifact list back with no indication savePath
   * was never used.
   */
  public async getBuildArtifacts(
    params: GetBuildArtifactsParams
  ): Promise<{ artifacts: BuildInterfaces.BuildArtifact[] } | { artifact: BuildInterfaces.BuildArtifact } | { savePath: string; size: number }> {
    try {
      const buildApi = await this.getBuildApi();

      if (!params.artifactName) {
        if (params.savePath) {
          throw new Error(
            "savePath requires artifactName - Azure DevOps has no endpoint to download all of a build's " +
            "artifacts as a single zip. Call getBuildArtifacts without savePath to list artifact names first."
          );
        }
        return { artifacts: await buildApi.getArtifacts(this.config.project, params.buildId) };
      }

      if (!params.savePath) {
        return { artifact: await buildApi.getArtifact(this.config.project, params.buildId, params.artifactName) };
      }

      const contentStream = await buildApi.getArtifactContentZip(this.config.project, params.buildId, params.artifactName);
      return await downloadStreamToFile(contentStream, params.savePath);
    } catch (error) {
      console.error(`Error getting artifacts for build ${params.buildId}:`, error);
      throw error;
    }
  }

  /**
   * Associates an automated test (identified by its fully-qualified name, as published to a
   * specific pipeline run's test results) with a Test Case work item - the same effect as the
   * Test Case's "Associated Automation" -> Browse -> pick pipeline -> pick run -> pick test
   * flow in the Azure DevOps UI (see
   * https://learn.microsoft.com/en-us/azure/devops/test/associate-automated-test-with-test-case).
   *
   * Azure DevOps links published pipeline test results back to a test case by matching
   * AutomatedTestName + AutomatedTestStorage exactly, not by the AutomatedTestId GUID - so an
   * existing GUID on the test case is preserved (association is idempotent / can be re-run
   * safely), and a fresh one is only generated the first time a test case is associated.
   */
  public async associateAutomatedTestWithTestCase(
    params: AssociateAutomatedTestWithTestCaseParams
  ): Promise<{ workItem: WitInterfaces.WorkItem; matchedResult: TestInterfaces.ShallowTestCaseResult }> {
    try {
      // Fetch every published result (not just the first page) - matching against a truncated
      // page would either miss a real result entirely, or worse, miss a same-named result on a
      // later page that would have changed the ambiguity check below.
      const results = await this.getAllTestResultsByBuild(params.buildId);
      const matches = results.filter((r) => r.automatedTestName === params.automatedTestName);

      if (matches.length === 0) {
        throw new Error(
          `No test result named "${params.automatedTestName}" was found in build ${params.buildId}. ` +
          `Use getBuildTestResults to list the automated test names actually published by that run.`
        );
      }

      // A build can publish more than one result for the same test name (matrix/multi-config
      // runs, multiple test runs in one build, reruns) - which is harmless as long as they all
      // agree on the storage (assembly/container) to record, but picking an arbitrary one when
      // they disagree could silently associate the test case with the wrong storage.
      const distinctStorages = [...new Set(matches.map((r) => r.automatedTestStorage).filter(Boolean))];
      if (distinctStorages.length > 1) {
        const candidates = matches
          .map((r) => `runId=${r.runId}, storage="${r.automatedTestStorage}", outcome=${r.outcome}`)
          .join("; ");
        throw new Error(
          `Build ${params.buildId} published ${matches.length} test results named "${params.automatedTestName}" ` +
          `across different automatedTestStorage values, so which one to associate is ambiguous: ${candidates}. ` +
          `Re-run against a build/run that publishes this test from a single storage.`
        );
      }

      const match = matches[0];
      if (!match.automatedTestStorage) {
        throw new Error(
          `Test result "${params.automatedTestName}" in build ${params.buildId} has no automatedTestStorage ` +
          `(the assembly/container the test runs from) - Azure DevOps requires this to associate the test.`
        );
      }

      const witApi = await this.getWorkItemTrackingApi();
      const existing = await witApi.getWorkItem(params.testCaseId, undefined, undefined, undefined, this.config.project);
      const existingAutomatedTestId = existing.fields?.["Microsoft.VSTS.TCM.AutomatedTestId"];
      const automatedTestId = existingAutomatedTestId || randomUUID();

      const patchDocument: JsonPatchOperation[] = [
        { op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.AutomatedTestName", value: params.automatedTestName },
        { op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.AutomatedTestStorage", value: match.automatedTestStorage },
        { op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.AutomatedTestType", value: params.automatedTestType || DEFAULT_AUTOMATED_TEST_TYPE },
        { op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.AutomatedTestId", value: automatedTestId },
        { op: Operation.Add, path: "/fields/Microsoft.VSTS.TCM.AutomationStatus", value: "Automated" },
      ];

      const workItem = await witApi.updateWorkItem(undefined, patchDocument, params.testCaseId, this.config.project);

      return { workItem, matchedResult: match };
    } catch (error) {
      console.error(`Error associating automated test with test case ${params.testCaseId}:`, error);
      throw error;
    }
  }
}
