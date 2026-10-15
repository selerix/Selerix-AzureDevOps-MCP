// Parameter and response types for the test execution tools (run, record results, history, bugs).

/** Outcomes a tester can record against a whole test result. */
export type TestResultOutcome = "Passed" | "Failed" | "Paused" | "Blocked" | "NotApplicable";

/** Outcomes a tester can record against a single test step. */
export type TestStepOutcome = "Passed" | "Failed";

/** A test case step parsed out of the test case's Microsoft.VSTS.TCM.Steps field. */
export interface ParsedTestStep {
  /** Step id as stored in the steps XML (1-based within the test case) */
  id: number;
  /** Zero-padded 8-digit action path used by the results API, e.g. "00000002" */
  actionPath: string;
  type: "ActionStep" | "ValidateStep";
  action: string;
  expectedResult: string;
}

/** Test point that a run was (or will be) created for. */
export interface ResolvedTestPoint {
  pointId: number;
  testCaseId: number;
  suiteId?: number;
  planId: number;
}

export type TestType = "manual" | "automated";
export type TestRunner = "webApplication" | "releaseStage";

export interface ListReleaseDefinitionsParams {
  searchText?: string;
  top?: number;
}

export interface GetReleaseDefinitionDetailsParams {
  releaseDefinitionId: number;
}

export interface StartTestRunParams {
  /** Test case work item ids to run (one or many) */
  testCaseIds: number[];
  planId: number;
  /** Suite holding the test cases; looked up per test case within the plan when omitted */
  suiteId?: number;
  testType: TestType;
  /** manual -> webApplication (web runner); automated -> releaseStage */
  runner: TestRunner;
  runName?: string;

  // automated / releaseStage only
  buildPipelineId?: number;
  /** Build id; takes precedence over buildNumber */
  buildId?: number;
  /** Build number such as "20261015.1"; the latest completed build is used when neither is given */
  buildNumber?: string;
  releasePipelineId?: number;
  /** Name of the release pipeline stage (environment) to deploy and run the tests in */
  stageName?: string;
  /** Alias of the release artifact the build is bound to; inferred from buildPipelineId when omitted */
  artifactAlias?: string;
  /** Release variable that receives the test run id so the stage's test task can pick it up */
  runIdVariableName?: string;
}

export interface TestResultRef {
  runId: number;
  resultId: number;
}

export interface GetTestResultParams extends TestResultRef {
  /** Include the test case's steps merged with any outcomes already recorded (default true) */
  includeSteps?: boolean;
}

export interface StepOutcomeUpdate {
  /** Step id as shown by getTestResult (1-based within the test case) */
  stepId: number;
  outcome: TestStepOutcome;
  /** Comment shown on the step; mainly useful on a failing step */
  comment?: string;
}

export interface SetTestStepResultsParams extends TestResultRef {
  /** Selected steps to mark */
  steps?: StepOutcomeUpdate[];
  /** Mark every step of the test case with this outcome (explicit `steps` entries still win) */
  allStepsOutcome?: TestStepOutcome;
  /** Comment applied to every step marked through allStepsOutcome */
  allStepsComment?: string;
}

export interface SetTestResultOutcomeParams extends TestResultRef {
  outcome: TestResultOutcome;
  comment?: string;
}

export interface CompleteTestRunParams {
  runId: number;
  comment?: string;
}

export interface StartedTestResult {
  resultId: number;
  testCaseId?: number;
  pointId?: number;
  outcome?: string;
  state?: string;
}
