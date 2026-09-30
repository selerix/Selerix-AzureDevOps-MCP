import * as fs from "fs";
import { randomUUID } from "crypto";
import { pipeline as streamPipeline } from "stream/promises";
import { IBuildApi } from "azure-devops-node-api/BuildApi";
import { ITestApi } from "azure-devops-node-api/TestApi";
import * as BuildInterfaces from "azure-devops-node-api/interfaces/BuildInterfaces";
import * as TestInterfaces from "azure-devops-node-api/interfaces/TestInterfaces";
import {
  JsonPatchOperation,
  Operation,
} from "azure-devops-node-api/interfaces/common/VSSInterfaces";
import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
import {
  ListPipelinesParams,
  GetPipelineDetailsParams,
  UpdatePipelineVariablesParams,
  ScheduleBuildParams,
  ListBuildsParams,
  GetBuildDetailsParams,
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

  // ----- Pipelines / build definitions -----

  public async listPipelines(params: ListPipelinesParams): Promise<BuildInterfaces.BuildDefinitionReference[]> {
    try {
      const buildApi = await this.getBuildApi();
      const result = await buildApi.getDefinitions(
        this.config.project,
        params.nameFilter,
        undefined,
        undefined,
        undefined,
        params.top,
        undefined,
        undefined,
        undefined,
        params.path
      );
      return result;
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
        variables[name] = {
          value: edit.value !== undefined ? edit.value : existing.value,
          isSecret: edit.isSecret !== undefined ? edit.isSecret : existing.isSecret,
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
      const result = await buildApi.getBuilds(
        this.config.project,
        params.pipelineId ? [params.pipelineId] : undefined,
        undefined,
        undefined,
        params.minTime ? new Date(params.minTime) : undefined,
        params.maxTime ? new Date(params.maxTime) : undefined,
        undefined,
        undefined,
        params.statusFilter ? BUILD_STATUS_MAP[params.statusFilter] : undefined,
        params.resultFilter ? BUILD_RESULT_MAP[params.resultFilter] : undefined,
        undefined,
        undefined,
        params.top,
        undefined,
        undefined,
        undefined,
        params.queryOrder ? BUILD_QUERY_ORDER_MAP[params.queryOrder] : undefined,
        params.branchName
      );
      return result;
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

  public async getBuildTestResults(params: GetBuildTestResultsParams): Promise<TestInterfaces.ShallowTestCaseResult[]> {
    try {
      const testApi = await this.getTestApi();
      const outcomes = params.outcomeFilter?.map((o) => TEST_OUTCOME_MAP[o]);
      const result = await testApi.getTestResultsByBuild(
        this.config.project,
        params.buildId,
        undefined,
        outcomes,
        params.top
      );
      return result;
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
  public async getBuildLogs(params: GetBuildLogsParams): Promise<BuildInterfaces.BuildLog[] | string[] | { savePath: string; size: number }> {
    try {
      const buildApi = await this.getBuildApi();

      if (!params.savePath) {
        if (params.logId !== undefined) {
          return await buildApi.getBuildLogLines(this.config.project, params.buildId, params.logId);
        }
        return await buildApi.getBuildLogs(this.config.project, params.buildId);
      }

      const contentStream =
        params.logId !== undefined
          ? await buildApi.getBuildLogZip(this.config.project, params.buildId, params.logId)
          : await buildApi.getBuildLogsZip(this.config.project, params.buildId);

      const tempPath = `${params.savePath}.download-${randomUUID()}.tmp`;
      try {
        await streamPipeline(contentStream, fs.createWriteStream(tempPath, { flags: "wx" }));
        await fs.promises.rename(tempPath, params.savePath);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true });
        throw error;
      }
      const { size } = fs.statSync(params.savePath);
      return { savePath: params.savePath, size };
    } catch (error) {
      console.error(`Error getting logs for build ${params.buildId}:`, error);
      throw error;
    }
  }

  /**
   * Lists a build's artifacts, or downloads one artifact's content zip to disk when both
   * artifactName and savePath are given.
   */
  public async getBuildArtifacts(params: GetBuildArtifactsParams): Promise<BuildInterfaces.BuildArtifact[] | BuildInterfaces.BuildArtifact | { savePath: string; size: number }> {
    try {
      const buildApi = await this.getBuildApi();

      if (!params.artifactName) {
        return await buildApi.getArtifacts(this.config.project, params.buildId);
      }

      if (!params.savePath) {
        return await buildApi.getArtifact(this.config.project, params.buildId, params.artifactName);
      }

      const contentStream = await buildApi.getArtifactContentZip(this.config.project, params.buildId, params.artifactName);
      const tempPath = `${params.savePath}.download-${randomUUID()}.tmp`;
      try {
        await streamPipeline(contentStream, fs.createWriteStream(tempPath, { flags: "wx" }));
        await fs.promises.rename(tempPath, params.savePath);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true });
        throw error;
      }
      const { size } = fs.statSync(params.savePath);
      return { savePath: params.savePath, size };
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
  public async associateAutomatedTestWithTestCase(params: AssociateAutomatedTestWithTestCaseParams): Promise<any> {
    try {
      const testApi = await this.getTestApi();
      const results = await testApi.getTestResultsByBuild(this.config.project, params.buildId);
      const match = results.find((r) => r.automatedTestName === params.automatedTestName);

      if (!match) {
        throw new Error(
          `No test result named "${params.automatedTestName}" was found in build ${params.buildId}. ` +
          `Use getBuildTestResults to list the automated test names actually published by that run.`
        );
      }

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
