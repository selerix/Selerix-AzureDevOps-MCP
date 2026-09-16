import { ITestPlanApi } from "azure-devops-node-api/TestPlanApi";
import * as TestPlanInterfaces from "azure-devops-node-api/interfaces/TestPlanInterfaces";
import { AzureDevOpsConfig } from "../Interfaces/AzureDevOps";
import { AzureDevOpsService } from "./AzureDevOpsService";
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
  TestSuiteTypeParam,
} from "../Interfaces/TestPlans";

const SUITE_TYPE_MAP: Record<TestSuiteTypeParam, TestPlanInterfaces.TestSuiteType> = {
  staticTestSuite: TestPlanInterfaces.TestSuiteType.StaticTestSuite,
  dynamicTestSuite: TestPlanInterfaces.TestSuiteType.DynamicTestSuite,
  requirementTestSuite: TestPlanInterfaces.TestSuiteType.RequirementTestSuite,
};

export class TestPlansService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /**
   * Get the Test Plan API client
   */
  private async getTestPlanApi(): Promise<ITestPlanApi> {
    return await this.connection.getTestPlanApi();
  }

  // ----- Test Plans -----

  public async createTestPlan(params: CreateTestPlanParams): Promise<TestPlanInterfaces.TestPlan> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      const createParams: TestPlanInterfaces.TestPlanCreateParams = {
        name: params.name,
        iteration: params.iteration,
        areaPath: params.areaPath,
        description: params.description,
        startDate: params.startDate ? new Date(params.startDate) : undefined,
        endDate: params.endDate ? new Date(params.endDate) : undefined,
        state: params.state,
      };
      return await testPlanApi.createTestPlan(createParams, this.config.project);
    } catch (error) {
      console.error(`Error creating test plan ${params.name}:`, error);
      throw error;
    }
  }

  public async getTestPlans(params: GetTestPlansParams): Promise<TestPlanInterfaces.TestPlan[]> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      const result = await testPlanApi.getTestPlans(
        this.config.project,
        params.owner,
        params.continuationToken,
        params.includePlanDetails,
        params.filterActivePlans
      );
      return result;
    } catch (error) {
      console.error("Error listing test plans:", error);
      throw error;
    }
  }

  public async getTestPlanById(params: GetTestPlanByIdParams): Promise<TestPlanInterfaces.TestPlan> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await testPlanApi.getTestPlanById(this.config.project, params.planId);
    } catch (error) {
      console.error(`Error getting test plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async updateTestPlan(params: UpdateTestPlanParams): Promise<TestPlanInterfaces.TestPlan> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      let name = params.name;
      let iteration = params.iteration;
      if (name === undefined || iteration === undefined) {
        const existing = await testPlanApi.getTestPlanById(this.config.project, params.planId);
        name = name ?? existing.name;
        iteration = iteration ?? existing.iteration;
      }
      const updateParams: TestPlanInterfaces.TestPlanUpdateParams = {
        name,
        iteration,
        areaPath: params.areaPath,
        description: params.description,
        startDate: params.startDate ? new Date(params.startDate) : undefined,
        endDate: params.endDate ? new Date(params.endDate) : undefined,
        state: params.state,
        revision: params.revision,
      };
      return await testPlanApi.updateTestPlan(updateParams, this.config.project, params.planId);
    } catch (error) {
      console.error(`Error updating test plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async deleteTestPlan(params: DeleteTestPlanParams): Promise<void> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      await testPlanApi.deleteTestPlan(this.config.project, params.planId);
    } catch (error) {
      console.error(`Error deleting test plan ${params.planId}:`, error);
      throw error;
    }
  }

  // ----- Test Suites -----

  public async createTestSuite(params: CreateTestSuiteParams): Promise<TestPlanInterfaces.TestSuite> {
    try {
      if (params.suiteType === 'requirementTestSuite' && !params.requirementId) {
        throw new Error("requirementId is required when suiteType is 'requirementTestSuite'");
      }
      if (params.suiteType === 'dynamicTestSuite' && !params.queryString) {
        throw new Error("queryString is required when suiteType is 'dynamicTestSuite'");
      }
      const testPlanApi = await this.getTestPlanApi();
      const createParams: TestPlanInterfaces.TestSuiteCreateParams = {
        name: params.name,
        suiteType: SUITE_TYPE_MAP[params.suiteType || 'staticTestSuite'],
        queryString: params.queryString,
        requirementId: params.requirementId,
        parentSuite: { id: params.parentSuiteId, name: '' },
      };
      return await testPlanApi.createTestSuite(createParams, this.config.project, params.planId);
    } catch (error) {
      console.error(`Error creating test suite ${params.name} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async getTestSuites(params: GetTestSuitesParams): Promise<TestPlanInterfaces.TestSuite[]> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      const result = await testPlanApi.getTestSuitesForPlan(
        this.config.project,
        params.planId,
        TestPlanInterfaces.SuiteExpand.Children,
        params.continuationToken,
        params.asTreeView
      );
      return result;
    } catch (error) {
      console.error(`Error listing test suites for plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async getTestSuiteById(params: GetTestSuiteByIdParams): Promise<TestPlanInterfaces.TestSuite> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await testPlanApi.getTestSuiteById(
        this.config.project,
        params.planId,
        params.suiteId,
        params.includeChildren ? TestPlanInterfaces.SuiteExpand.Children : TestPlanInterfaces.SuiteExpand.None
      );
    } catch (error) {
      console.error(`Error getting test suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async updateTestSuite(params: UpdateTestSuiteParams): Promise<TestPlanInterfaces.TestSuite> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      let name = params.name;
      if (name === undefined) {
        const existing = await testPlanApi.getTestSuiteById(this.config.project, params.planId, params.suiteId);
        name = existing.name;
      }
      const updateParams: TestPlanInterfaces.TestSuiteUpdateParams = {
        name,
        queryString: params.queryString,
      };
      return await testPlanApi.updateTestSuite(updateParams, this.config.project, params.planId, params.suiteId);
    } catch (error) {
      console.error(`Error updating test suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async deleteTestSuite(params: DeleteTestSuiteParams): Promise<void> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      await testPlanApi.deleteTestSuite(this.config.project, params.planId, params.suiteId);
    } catch (error) {
      console.error(`Error deleting test suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  // ----- Test Cases (suite membership) -----

  public async addTestCasesToSuite(params: AddTestCasesToSuiteParams): Promise<TestPlanInterfaces.TestCase[]> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      const suiteTestCaseParams: TestPlanInterfaces.SuiteTestCaseCreateUpdateParameters[] = params.testCaseIds.map(
        (id) => ({ workItem: { id } })
      );
      return await testPlanApi.addTestCasesToSuite(
        suiteTestCaseParams,
        this.config.project,
        params.planId,
        params.suiteId
      );
    } catch (error) {
      console.error(`Error adding test cases to suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async getTestCasesFromSuite(params: GetTestCasesFromSuiteParams): Promise<TestPlanInterfaces.TestCase[]> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      const result = await testPlanApi.getTestCaseList(
        this.config.project,
        params.planId,
        params.suiteId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        params.isRecursive
      );
      return result;
    } catch (error) {
      console.error(`Error getting test cases for suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async getSuitesForTestCase(params: GetSuitesForTestCaseParams): Promise<TestPlanInterfaces.TestSuite[]> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await testPlanApi.getSuitesByTestCaseId(params.testCaseId);
    } catch (error) {
      console.error(`Error getting suites for test case ${params.testCaseId}:`, error);
      throw error;
    }
  }

  public async removeTestCasesFromSuite(params: RemoveTestCasesFromSuiteParams): Promise<void> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      await testPlanApi.removeTestCasesFromSuite(
        this.config.project,
        params.planId,
        params.suiteId,
        params.testCaseIds.join(',')
      );
    } catch (error) {
      console.error(`Error removing test cases from suite ${params.suiteId} in plan ${params.planId}:`, error);
      throw error;
    }
  }

  public async deleteTestCase(params: DeleteTestCaseParams): Promise<void> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      await testPlanApi.deleteTestCase(this.config.project, params.testCaseId);
    } catch (error) {
      console.error(`Error deleting test case ${params.testCaseId}:`, error);
      throw error;
    }
  }
}
