import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { PipelinesService } from "../Services/PipelinesService";
import { formatMcpResponse, formatErrorResponse, McpResponse } from "../Interfaces/Common";
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
} from "../Interfaces/Pipelines";
import getClassMethods from "../utils/getClassMethods";

export class PipelinesTools {
  private service: PipelinesService;

  constructor(config: AzureDevOpsConfig) {
    this.service = new PipelinesService(config);
  }

  async listPipelines(params: ListPipelinesParams): Promise<McpResponse> {
    try {
      const result = await this.service.listPipelines(params);
      return formatMcpResponse(result, `Found ${result.length} pipeline(s)`);
    } catch (error: unknown) {
      console.error("Error listing pipelines:", error);
      return formatErrorResponse(error);
    }
  }

  async getPipelineDetails(params: GetPipelineDetailsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getPipelineDetails(params);
      return formatMcpResponse(result, `Pipeline ${params.pipelineId} details`);
    } catch (error: unknown) {
      console.error("Error getting pipeline details:", error);
      return formatErrorResponse(error);
    }
  }

  async updatePipelineVariables(params: UpdatePipelineVariablesParams): Promise<McpResponse> {
    try {
      const result = await this.service.updatePipelineVariables(params);
      return formatMcpResponse(result, `Updated variables for pipeline ${params.pipelineId}`);
    } catch (error: unknown) {
      console.error("Error updating pipeline variables:", error);
      return formatErrorResponse(error);
    }
  }

  async scheduleBuild(params: ScheduleBuildParams): Promise<McpResponse> {
    try {
      const result = await this.service.scheduleBuild(params);
      return formatMcpResponse(result, `Queued build ${result.id} for pipeline ${params.pipelineId}`);
    } catch (error: unknown) {
      console.error("Error scheduling build:", error);
      return formatErrorResponse(error);
    }
  }

  async listBuilds(params: ListBuildsParams): Promise<McpResponse> {
    try {
      const result = await this.service.listBuilds(params);
      return formatMcpResponse(result, `Found ${result.length} build(s)`);
    } catch (error: unknown) {
      console.error("Error listing builds:", error);
      return formatErrorResponse(error);
    }
  }

  async getBuildDetails(params: GetBuildDetailsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getBuildDetails(params);
      return formatMcpResponse(result, `Build ${params.buildId} details`);
    } catch (error: unknown) {
      console.error("Error getting build details:", error);
      return formatErrorResponse(error);
    }
  }

  async cancelBuild(params: CancelBuildParams): Promise<McpResponse> {
    try {
      const result = await this.service.cancelBuild(params);
      return formatMcpResponse(result, `Cancellation requested for build ${params.buildId}`);
    } catch (error: unknown) {
      console.error("Error cancelling build:", error);
      return formatErrorResponse(error);
    }
  }

  async getBuildTestResults(params: GetBuildTestResultsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getBuildTestResults(params);
      const passed = result.filter((r) => r.outcome === "Passed").length;
      const failed = result.filter((r) => r.outcome === "Failed").length;
      return formatMcpResponse(result, `Build ${params.buildId}: ${result.length} test result(s) (${passed} passed, ${failed} failed)`);
    } catch (error: unknown) {
      console.error("Error getting build test results:", error);
      return formatErrorResponse(error);
    }
  }

  async getBuildLogs(params: GetBuildLogsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getBuildLogs(params);
      const message = params.savePath
        ? `Downloaded logs for build ${params.buildId} to ${params.savePath}`
        : `Logs for build ${params.buildId}`;
      return formatMcpResponse(result, message);
    } catch (error: unknown) {
      console.error("Error getting build logs:", error);
      return formatErrorResponse(error);
    }
  }

  async getBuildArtifacts(params: GetBuildArtifactsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getBuildArtifacts(params);
      const message = params.artifactName && params.savePath
        ? `Downloaded artifact '${params.artifactName}' for build ${params.buildId} to ${params.savePath}`
        : `Artifacts for build ${params.buildId}`;
      return formatMcpResponse(result, message);
    } catch (error: unknown) {
      console.error("Error getting build artifacts:", error);
      return formatErrorResponse(error);
    }
  }

  async associateAutomatedTestWithTestCase(params: AssociateAutomatedTestWithTestCaseParams): Promise<McpResponse> {
    try {
      const result = await this.service.associateAutomatedTestWithTestCase(params);
      return formatMcpResponse(
        result,
        `Associated automated test '${params.automatedTestName}' (from build ${params.buildId}) with test case ${params.testCaseId}`
      );
    } catch (error: unknown) {
      console.error("Error associating automated test with test case:", error);
      return formatErrorResponse(error);
    }
  }
}

export const PipelinesToolMethods = getClassMethods(PipelinesTools.prototype);
