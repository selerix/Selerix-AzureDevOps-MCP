import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { TestPlansService } from "../Services/TestPlansService";
import { formatMcpResponse, formatErrorResponse, McpResponse } from '../Interfaces/Common';
import {
  CreateTestPlanParams,
  GetTestPlansParams,
  GetTestPlanByIdParams,
  UpdateTestPlanParams,
  DeleteTestPlanParams,
  CreateTestSuiteParams,
  GetTestSuitesParams,
  GetTestSuiteByIdParams,
  UpdateTestSuiteParams,
  DeleteTestSuiteParams,
  AddTestCasesToSuiteParams,
  GetTestCasesFromSuiteParams,
  GetSuitesForTestCaseParams,
  RemoveTestCasesFromSuiteParams,
  DeleteTestCaseParams,
} from "../Interfaces/TestPlans";
import getClassMethods from "../utils/getClassMethods";

export class TestPlansTools {
  private service: TestPlansService;

  constructor(config: AzureDevOpsConfig) {
    this.service = new TestPlansService(config);
  }

  async createTestPlan(params: CreateTestPlanParams): Promise<McpResponse> {
    try {
      const result = await this.service.createTestPlan(params);
      return formatMcpResponse(result, `Test plan '${params.name}' created`);
    } catch (error: unknown) {
      console.error('Error creating test plan:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestPlans(params: GetTestPlansParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestPlans(params);
      return formatMcpResponse(result, `Found ${result.items.length} test plan(s)`);
    } catch (error: unknown) {
      console.error('Error listing test plans:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestPlanById(params: GetTestPlanByIdParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestPlanById(params);
      return formatMcpResponse(result, `Test plan ${params.planId} details`);
    } catch (error: unknown) {
      console.error('Error getting test plan:', error);
      return formatErrorResponse(error);
    }
  }

  async updateTestPlan(params: UpdateTestPlanParams): Promise<McpResponse> {
    try {
      const result = await this.service.updateTestPlan(params);
      return formatMcpResponse(result, `Test plan ${params.planId} updated`);
    } catch (error: unknown) {
      console.error('Error updating test plan:', error);
      return formatErrorResponse(error);
    }
  }

  async deleteTestPlan(params: DeleteTestPlanParams): Promise<McpResponse> {
    try {
      await this.service.deleteTestPlan(params);
      return formatMcpResponse({ planId: params.planId }, `Test plan ${params.planId} deleted`);
    } catch (error: unknown) {
      console.error('Error deleting test plan:', error);
      return formatErrorResponse(error);
    }
  }

  async createTestSuite(params: CreateTestSuiteParams): Promise<McpResponse> {
    try {
      const result = await this.service.createTestSuite(params);
      return formatMcpResponse(result, `Test suite '${params.name}' created in plan ${params.planId}`);
    } catch (error: unknown) {
      console.error('Error creating test suite:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestSuites(params: GetTestSuitesParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestSuites(params);
      return formatMcpResponse(result, `Found ${result.items.length} test suite(s) in plan ${params.planId}`);
    } catch (error: unknown) {
      console.error('Error listing test suites:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestSuiteById(params: GetTestSuiteByIdParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestSuiteById(params);
      return formatMcpResponse(result, `Test suite ${params.suiteId} details`);
    } catch (error: unknown) {
      console.error('Error getting test suite:', error);
      return formatErrorResponse(error);
    }
  }

  async updateTestSuite(params: UpdateTestSuiteParams): Promise<McpResponse> {
    try {
      const result = await this.service.updateTestSuite(params);
      return formatMcpResponse(result, `Test suite ${params.suiteId} updated`);
    } catch (error: unknown) {
      console.error('Error updating test suite:', error);
      return formatErrorResponse(error);
    }
  }

  async deleteTestSuite(params: DeleteTestSuiteParams): Promise<McpResponse> {
    try {
      await this.service.deleteTestSuite(params);
      return formatMcpResponse({ suiteId: params.suiteId }, `Test suite ${params.suiteId} deleted`);
    } catch (error: unknown) {
      console.error('Error deleting test suite:', error);
      return formatErrorResponse(error);
    }
  }

  async addTestCasesToSuite(params: AddTestCasesToSuiteParams): Promise<McpResponse> {
    try {
      const result = await this.service.addTestCasesToSuite(params);
      return formatMcpResponse(result, `Added ${params.testCaseIds.length} test case(s) to suite ${params.suiteId}`);
    } catch (error: unknown) {
      console.error('Error adding test cases to suite:', error);
      return formatErrorResponse(error);
    }
  }

  async getTestCasesFromSuite(params: GetTestCasesFromSuiteParams): Promise<McpResponse> {
    try {
      const result = await this.service.getTestCasesFromSuite(params);
      return formatMcpResponse(result, `Found ${result.items.length} test case(s) in suite ${params.suiteId}`);
    } catch (error: unknown) {
      console.error('Error getting test cases from suite:', error);
      return formatErrorResponse(error);
    }
  }

  async getSuitesForTestCase(params: GetSuitesForTestCaseParams): Promise<McpResponse> {
    try {
      const result = await this.service.getSuitesForTestCase(params);
      return formatMcpResponse(result, `Test case ${params.testCaseId} belongs to ${result.length} suite(s)`);
    } catch (error: unknown) {
      console.error('Error getting suites for test case:', error);
      return formatErrorResponse(error);
    }
  }

  async removeTestCasesFromSuite(params: RemoveTestCasesFromSuiteParams): Promise<McpResponse> {
    try {
      await this.service.removeTestCasesFromSuite(params);
      return formatMcpResponse(
        { suiteId: params.suiteId, testCaseIds: params.testCaseIds },
        `Removed ${params.testCaseIds.length} test case(s) from suite ${params.suiteId}`
      );
    } catch (error: unknown) {
      console.error('Error removing test cases from suite:', error);
      return formatErrorResponse(error);
    }
  }

  async deleteTestCase(params: DeleteTestCaseParams): Promise<McpResponse> {
    try {
      await this.service.deleteTestCase(params);
      return formatMcpResponse({ testCaseId: params.testCaseId }, `Test case ${params.testCaseId} deleted`);
    } catch (error: unknown) {
      console.error('Error deleting test case:', error);
      return formatErrorResponse(error);
    }
  }
}

export const TestPlansToolMethods = getClassMethods(TestPlansTools.prototype);
