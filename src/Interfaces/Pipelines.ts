// Pipeline / Build params

export interface ListPipelinesParams {
  nameFilter?: string;
  path?: string;
  top?: number;
}

export interface GetPipelineDetailsParams {
  pipelineId: number;
}

/**
 * A single variable edit. `value`/`isSecret`/`allowOverride` are all optional so a caller can
 * change only `allowOverride` on an existing variable without having to resend its value.
 */
export interface PipelineVariableEdit {
  value?: string;
  isSecret?: boolean;
  allowOverride?: boolean;
}

export interface UpdatePipelineVariablesParams {
  pipelineId: number;
  /** Variables to add or edit, keyed by variable name. */
  variables?: Record<string, PipelineVariableEdit>;
  /** Names of variables to remove from the definition entirely. */
  removeVariables?: string[];
}

export interface ScheduleBuildParams {
  pipelineId: number;
  /**
   * One-off variable overrides for this run only (e.g. `{ TestCaseFilter: "Priority=1" }`).
   * These do NOT persist to the pipeline definition, and only take effect for variables the
   * definition has marked as settable at queue time (`allowOverride: true`) - see
   * getPipelineDetails to check before scheduling.
   */
  variables?: Record<string, string>;
  sourceBranch?: string;
}

export interface ListBuildsParams {
  pipelineId?: number;
  top?: number;
  statusFilter?: 'none' | 'inProgress' | 'completed' | 'cancelling' | 'postponed' | 'notStarted' | 'all';
  resultFilter?: 'none' | 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled';
  branchName?: string;
  minTime?: string;
  maxTime?: string;
  queryOrder?: 'finishTimeAscending' | 'finishTimeDescending' | 'queueTimeAscending' | 'queueTimeDescending' | 'startTimeAscending' | 'startTimeDescending';
}

export interface GetBuildDetailsParams {
  buildId: number;
}

export type TestOutcomeFilter = 'none' | 'passed' | 'failed' | 'inconclusive' | 'timeout' | 'aborted' | 'blocked' | 'notExecuted' | 'warning' | 'error' | 'notApplicable' | 'paused' | 'inProgress' | 'notImpacted';

export interface GetBuildTestResultsParams {
  buildId: number;
  outcomeFilter?: TestOutcomeFilter[];
  top?: number;
}

export interface GetBuildLogsParams {
  buildId: number;
  /** A specific log id from a prior getBuildLogs call. Omit to list all logs, or to download all of them as a zip when savePath is set. */
  logId?: number;
  /** When set, downloads the log (or all logs as a zip if logId is omitted) to this local path instead of returning line text inline. */
  savePath?: string;
}

export interface GetBuildArtifactsParams {
  buildId: number;
  /** A specific artifact name from a prior getBuildArtifacts call. Omit to list all artifacts. */
  artifactName?: string;
  /** When set together with artifactName, downloads that artifact's content zip to this local path. */
  savePath?: string;
}

export interface AssociateAutomatedTestWithTestCaseParams {
  testCaseId: number;
  /** The pipeline run (build) whose published test results contain the automated test to associate. */
  buildId: number;
  /** The fully-qualified automated test name as it appears in getBuildTestResults, e.g. "MyNamespace.MyClass.MyTestMethod". */
  automatedTestName: string;
  /**
   * The automated test type recorded on the test case (e.g. "Unit Test", "Coded UI Test").
   * Azure DevOps' build-time test results don't report this, so it can't be inferred from the
   * matched result - defaults to "Unit Test" when omitted.
   */
  automatedTestType?: string;
}
