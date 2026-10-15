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

/** Kind of file being attached; ADO stores all of them as general attachments. */
export type TestAttachmentKind = "screenshot" | "recording" | "file";

export interface AttachmentContentParams {
  /** Local file to upload (a screenshot or screen recording captured by the caller, or any file) */
  filePath?: string;
  /** Alternative to filePath for small content; requires fileName */
  base64Content?: string;
  fileName?: string;
  comment?: string;
}

export interface AddTestResultAttachmentParams extends TestResultRef, AttachmentContentParams {
  kind?: TestAttachmentKind;
  /** Attach to a single step instead of the whole result */
  stepId?: number;
}

export interface AddTestRunAttachmentParams extends AttachmentContentParams {
  runId: number;
}

export interface AddTestResultCommentParams extends TestResultRef {
  comment: string;
  /** Replace the existing result comment instead of appending to it (default false) */
  replace?: boolean;
}

export type TestFailureType = "None" | "Regression" | "New Issue" | "Known Issue" | "Unknown" | "Other";

export interface UpdateTestResultAnalysisParams extends TestResultRef {
  failureType?: TestFailureType;
  /** Resolution, e.g. "Needs Investigation", "Product Issue", "Test Issue" (configured per project) */
  resolutionState?: string;
  comment?: string;
}

export interface TesterIdentity {
  /** Identity GUID (preferred) */
  id?: string;
  uniqueName?: string;
  displayName?: string;
}

export interface TestPointSelection {
  planId: number;
  testCaseIds: number[];
  /** Looked up per test case within the plan when omitted */
  suiteId?: number;
}

export interface AssignTesterParams extends TestPointSelection {
  tester: TesterIdentity;
}

export type ResetTestToActiveParams = TestPointSelection;

export interface GetTestRunsParams {
  /** Return this single run, with its results */
  runId?: number;
  planId?: number;
  buildId?: number;
  /** Runs started by this identity (display name or unique name) */
  owner?: string;
  automated?: boolean;
  /** Maximum runs to return (default 25) */
  top?: number;
}

export interface GetTestCaseExecutionHistoryParams {
  testCaseId: number;
  planId?: number;
  /** Maximum results to return (default 25) */
  top?: number;
}

export interface LinkTestRunToWorkItemsParams {
  runId: number;
  /** Link a single result; every result in the run when omitted */
  resultId?: number;
  workItemIds: number[];
  /** Also add a hyperlink to the run on each work item (default true) */
  addRunHyperlink?: boolean;
}

export interface CreateBugFromTestRunParams extends TestResultRef {
  /** Defaults to "<test case title> failed" */
  title?: string;
  /** Defaults to the test case's area path */
  areaPath?: string;
  /** Defaults to the test case's iteration path */
  iterationPath?: string;
  assignedTo?: string;
  /** e.g. "2 - High" */
  severity?: string;
  priority?: number;
  /** Extra text placed above the generated repro steps */
  additionalDetails?: string;
}

export interface UpdateBugWithTestRunParams extends TestResultRef {
  bugId: number;
  /** Extra text placed above the generated summary */
  additionalDetails?: string;
  /** Also append the generated repro steps to the bug's Repro Steps field (default false) */
  appendToReproSteps?: boolean;
}

export interface StartedTestResult {
  resultId: number;
  testCaseId?: number;
  pointId?: number;
  outcome?: string;
  state?: string;
}
