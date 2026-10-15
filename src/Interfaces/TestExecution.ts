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
