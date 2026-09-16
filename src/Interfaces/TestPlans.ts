// Test Plan params

export interface CreateTestPlanParams {
  name: string;
  iteration: string;
  areaPath?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  state?: string;
}

export interface GetTestPlansParams {
  owner?: string;
  includePlanDetails?: boolean;
  filterActivePlans?: boolean;
  continuationToken?: string;
}

export interface GetTestPlanByIdParams {
  planId: number;
}

export interface UpdateTestPlanParams {
  planId: number;
  name?: string;
  iteration?: string;
  areaPath?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  state?: string;
  revision?: number;
}

export interface DeleteTestPlanParams {
  planId: number;
}

// Test Suite params

export type TestSuiteTypeParam = 'staticTestSuite' | 'dynamicTestSuite' | 'requirementTestSuite';

export interface CreateTestSuiteParams {
  planId: number;
  name: string;
  parentSuiteId: number;
  suiteType?: TestSuiteTypeParam;
  queryString?: string;
}

export interface GetTestSuitesParams {
  planId: number;
  asTreeView?: boolean;
  continuationToken?: string;
}

export interface GetTestSuiteByIdParams {
  planId: number;
  suiteId: number;
  includeChildren?: boolean;
}

export interface UpdateTestSuiteParams {
  planId: number;
  suiteId: number;
  name?: string;
  queryString?: string;
}

export interface DeleteTestSuiteParams {
  planId: number;
  suiteId: number;
}

// Test Case (suite membership) params

export interface AddTestCasesToSuiteParams {
  planId: number;
  suiteId: number;
  testCaseIds: number[];
}

export interface GetTestCasesFromSuiteParams {
  planId: number;
  suiteId: number;
  isRecursive?: boolean;
}

export interface GetSuitesForTestCaseParams {
  testCaseId: number;
}

export interface RemoveTestCasesFromSuiteParams {
  planId: number;
  suiteId: number;
  testCaseIds: number[];
}

export interface DeleteTestCaseParams {
  testCaseId: number;
}
