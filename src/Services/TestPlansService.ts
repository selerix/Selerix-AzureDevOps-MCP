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
  PagedResult,
} from "../Interfaces/TestPlans";

const SUITE_TYPE_MAP: Record<TestSuiteTypeParam, TestPlanInterfaces.TestSuiteType> = {
  staticTestSuite: TestPlanInterfaces.TestSuiteType.StaticTestSuite,
  dynamicTestSuite: TestPlanInterfaces.TestSuiteType.DynamicTestSuite,
  requirementTestSuite: TestPlanInterfaces.TestSuiteType.RequirementTestSuite,
};

/**
 * The generated ITestPlanApi methods only return the deserialized response body, but Azure
 * DevOps returns the next-page continuation token in the `x-ms-continuationtoken` response
 * header, not the body. `vsoClient`/`rest`/`createRequestOptions`/`formatResponse` are public
 * members of the underlying ClientApiBase, so this replays the same request the generated
 * method would make and also reads that header.
 */
interface RawTestPlanApiClient {
  vsoClient: {
    getVersioningData(
      apiVersion: string,
      area: string,
      locationId: string,
      routeValues: Record<string, any>,
      queryParams?: Record<string, any>
    ): Promise<{ requestUrl: string; apiVersion: string }>;
  };
  rest: {
    get(url: string, options?: any): Promise<{ result: any; headers: Record<string, string> }>;
  };
  createRequestOptions(type: string, apiVersion?: string): any;
  formatResponse(data: any, responseTypeMetadata: any, isCollection: boolean): any;
}

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

  private async getPagedResult<T>(
    testPlanApi: ITestPlanApi,
    apiVersion: string,
    resourceId: string,
    routeValues: Record<string, any>,
    queryValues: Record<string, any>,
    responseTypeMetadata: any
  ): Promise<PagedResult<T>> {
    const api = testPlanApi as unknown as RawTestPlanApiClient;
    const verData = await api.vsoClient.getVersioningData(apiVersion, "testplan", resourceId, routeValues, queryValues);
    const options = api.createRequestOptions('application/json', verData.apiVersion);
    const res = await api.rest.get(verData.requestUrl, options);
    const items: T[] = api.formatResponse(res.result, responseTypeMetadata, true);
    return { items, continuationToken: res.headers?.['x-ms-continuationtoken'] };
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

  public async getTestPlans(params: GetTestPlansParams): Promise<PagedResult<TestPlanInterfaces.TestPlan>> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await this.getPagedResult<TestPlanInterfaces.TestPlan>(
        testPlanApi,
        "7.2-preview.1",
        "0e292477-a0c2-47f3-a9b6-34f153d627f4",
        { project: this.config.project },
        {
          owner: params.owner,
          continuationToken: params.continuationToken,
          includePlanDetails: params.includePlanDetails,
          filterActivePlans: params.filterActivePlans,
        },
        TestPlanInterfaces.TypeInfo.TestPlan
      );
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

  public async getTestSuites(params: GetTestSuitesParams): Promise<PagedResult<TestPlanInterfaces.TestSuite>> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await this.getPagedResult<TestPlanInterfaces.TestSuite>(
        testPlanApi,
        "7.2-preview.1",
        "1046d5d3-ab61-4ca7-a65a-36118a978256",
        { project: this.config.project, planId: params.planId },
        {
          expand: TestPlanInterfaces.SuiteExpand.Children,
          continuationToken: params.continuationToken,
          asTreeView: params.asTreeView,
        },
        TestPlanInterfaces.TypeInfo.TestSuite
      );
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

  public async getTestCasesFromSuite(params: GetTestCasesFromSuiteParams): Promise<PagedResult<TestPlanInterfaces.TestCase>> {
    try {
      const testPlanApi = await this.getTestPlanApi();
      return await this.getPagedResult<TestPlanInterfaces.TestCase>(
        testPlanApi,
        "7.2-preview.3",
        "a9bd61ac-45cf-4d13-9441-43dcd01edf8d",
        { project: this.config.project, planId: params.planId, suiteId: params.suiteId },
        {
          continuationToken: params.continuationToken,
          isRecursive: params.isRecursive,
        },
        TestPlanInterfaces.TypeInfo.TestCase
      );
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
