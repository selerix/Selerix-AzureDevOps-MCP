import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { TestExecutionService } from "../Services/TestExecutionService";
import { formatMcpResponse, formatErrorResponse, McpResponse } from '../Interfaces/Common';
import {
  ListReleaseDefinitionsParams,
  GetReleaseDefinitionDetailsParams,
  StartTestRunParams,
  GetTestResultParams,
  SetTestStepResultsParams,
  SetTestResultOutcomeParams,
  CompleteTestRunParams,
  AddTestResultAttachmentParams,
  AddTestRunAttachmentParams,
  AddTestResultCommentParams,
  UpdateTestResultAnalysisParams,
  AssignTesterParams,
  ResetTestToActiveParams,
  GetTestRunsParams,
  GetTestCaseExecutionHistoryParams,
  LinkTestRunToWorkItemsParams,
  CreateBugFromTestRunParams,
  UpdateBugWithTestRunParams
} from "../Interfaces/TestExecution";
import getClassMethods from "../utils/getClassMethods";

export class TestExecutionTools {
  private service: TestExecutionService;

  constructor(config: AzureDevOpsConfig) {
    this.service = new TestExecutionService(config);
  }

  async listReleaseDefinitions(params: ListReleaseDefinitionsParams): Promise<McpResponse> {
    try {
      const result = await this.service.listReleaseDefinitions(params);
      return formatMcpResponse(result, "Release definitions listed");
    } catch (error: unknown) {
      console.error('Error in listReleaseDefinitions:', error);
      return formatErrorResponse(error);
    }
  }

  async getReleaseDefinitionDetails(params: GetReleaseDefinitionDetailsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getReleaseDefinitionDetails(params);
      return formatMcpResponse(result, "Release definition details");
    } catch (error: unknown) {
      console.error('Error in getReleaseDefinitionDetails:', error);
      return formatErrorResponse(error);
    }
  }

  async startTestRun(params: StartTestRunParams): Promise<McpResponse> {
    try {
      const result = await this.service.startTestRun(params);
      return formatMcpResponse(result, "Test run started");
    } catch (error: unknown) {
      console.error('Error in startTestRun:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestResult(params: GetTestResultParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestResult(params);
      return formatMcpResponse(result, "Test result");
    } catch (error: unknown) {
      console.error('Error in getTestResult:', error);
      return formatErrorResponse(error);
    }
  }

  async setTestStepResults(params: SetTestStepResultsParams): Promise<McpResponse> {
    try {
      const result = await this.service.setTestStepResults(params);
      return formatMcpResponse(result, "Step results recorded");
    } catch (error: unknown) {
      console.error('Error in setTestStepResults:', error);
      return formatErrorResponse(error);
    }
  }

  async setTestResultOutcome(params: SetTestResultOutcomeParams): Promise<McpResponse> {
    try {
      const result = await this.service.setTestResultOutcome(params);
      return formatMcpResponse(result, "Test result outcome set");
    } catch (error: unknown) {
      console.error('Error in setTestResultOutcome:', error);
      return formatErrorResponse(error);
    }
  }

  async completeTestRun(params: CompleteTestRunParams): Promise<McpResponse> {
    try {
      const result = await this.service.completeTestRun(params);
      return formatMcpResponse(result, "Test run completed");
    } catch (error: unknown) {
      console.error('Error in completeTestRun:', error);
      return formatErrorResponse(error);
    }
  }

  async addTestResultAttachment(params: AddTestResultAttachmentParams): Promise<McpResponse> {
    try {
      const result = await this.service.addTestResultAttachment(params);
      return formatMcpResponse(result, "Attachment added to test result");
    } catch (error: unknown) {
      console.error('Error in addTestResultAttachment:', error);
      return formatErrorResponse(error);
    }
  }

  async addTestRunAttachment(params: AddTestRunAttachmentParams): Promise<McpResponse> {
    try {
      const result = await this.service.addTestRunAttachment(params);
      return formatMcpResponse(result, "Attachment added to test run");
    } catch (error: unknown) {
      console.error('Error in addTestRunAttachment:', error);
      return formatErrorResponse(error);
    }
  }

  async addTestResultComment(params: AddTestResultCommentParams): Promise<McpResponse> {
    try {
      const result = await this.service.addTestResultComment(params);
      return formatMcpResponse(result, "Comment added to test result");
    } catch (error: unknown) {
      console.error('Error in addTestResultComment:', error);
      return formatErrorResponse(error);
    }
  }

  async updateTestResultAnalysis(params: UpdateTestResultAnalysisParams): Promise<McpResponse> {
    try {
      const result = await this.service.updateTestResultAnalysis(params);
      return formatMcpResponse(result, "Test result analysis updated");
    } catch (error: unknown) {
      console.error('Error in updateTestResultAnalysis:', error);
      return formatErrorResponse(error);
    }
  }

  async assignTester(params: AssignTesterParams): Promise<McpResponse> {
    try {
      const result = await this.service.assignTester(params);
      return formatMcpResponse(result, "Tester assigned");
    } catch (error: unknown) {
      console.error('Error in assignTester:', error);
      return formatErrorResponse(error);
    }
  }

  async resetTestToActive(params: ResetTestToActiveParams): Promise<McpResponse> {
    try {
      const result = await this.service.resetTestToActive(params);
      return formatMcpResponse(result, "Tests reset to active");
    } catch (error: unknown) {
      console.error('Error in resetTestToActive:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestRuns(params: GetTestRunsParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestRuns(params);
      return formatMcpResponse(result, "Test runs");
    } catch (error: unknown) {
      console.error('Error in getTestRuns:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestCaseExecutionHistory(params: GetTestCaseExecutionHistoryParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestCaseExecutionHistory(params);
      return formatMcpResponse(result, "Test case execution history");
    } catch (error: unknown) {
      console.error('Error in getTestCaseExecutionHistory:', error);
      return formatErrorResponse(error);
    }
  }

  async linkTestRunToWorkItems(params: LinkTestRunToWorkItemsParams): Promise<McpResponse> {
    try {
      const result = await this.service.linkTestRunToWorkItems(params);
      return formatMcpResponse(result, "Test run linked to work items");
    } catch (error: unknown) {
      console.error('Error in linkTestRunToWorkItems:', error);
      return formatErrorResponse(error);
    }
  }

  async createBugFromTestRun(params: CreateBugFromTestRunParams): Promise<McpResponse> {
    try {
      const result = await this.service.createBugFromTestRun(params);
      return formatMcpResponse(result, "Bug created from test result");
    } catch (error: unknown) {
      console.error('Error in createBugFromTestRun:', error);
      return formatErrorResponse(error);
    }
  }

  async updateBugWithTestRun(params: UpdateBugWithTestRunParams): Promise<McpResponse> {
    try {
      const result = await this.service.updateBugWithTestRun(params);
      return formatMcpResponse(result, "Bug updated with test result");
    } catch (error: unknown) {
      console.error('Error in updateBugWithTestRun:', error);
      return formatErrorResponse(error);
    }
  }
}

export const TestExecutionToolMethods = getClassMethods(TestExecutionTools.prototype);
