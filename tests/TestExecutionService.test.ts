import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TestExecutionService, parseTestSteps } from '../src/Services/TestExecutionService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

// A test case with a reference (step 2) to shared step set work item 49, which has two steps.
const SHARED_STEPS_XML =
  '<steps id="0" last="3">' +
  '<step id="1" type="ValidateStep"><parameterizedString isformatted="true">Start</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step>' +
  '<compref id="2" ref="49" />' +
  '<step id="3" type="ActionStep"><parameterizedString isformatted="true">Finish</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step>' +
  '</steps>';
const SHARED_SET_XML =
  '<steps id="0" last="2">' +
  '<step id="1" type="ActionStep"><parameterizedString isformatted="true">Open login</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step>' +
  '<step id="2" type="ActionStep"><parameterizedString isformatted="true">Sign in</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step>' +
  '</steps>';

const STEPS_XML =
  '<steps id="0" last="3">' +
  '<step id="2" type="ValidateStep"><parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Open the page&amp;nbsp;&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>' +
  '<parameterizedString isformatted="true">&lt;DIV&gt;Page loads&lt;/DIV&gt;</parameterizedString><description/></step>' +
  '<step id="3" type="ActionStep"><parameterizedString isformatted="true">Click save</parameterizedString>' +
  '<parameterizedString isformatted="true"></parameterizedString><description/></step>' +
  '</steps>';

describe('parseTestSteps', () => {
  it('parses ids, types and decodes HTML-encoded text', () => {
    const steps = parseTestSteps(STEPS_XML);
    expect(steps).toEqual([
      { id: 2, identifier: '2', actionPath: '00000002', type: 'ValidateStep', action: 'Open the page', expectedResult: 'Page loads' },
      { id: 3, identifier: '3', actionPath: '00000003', type: 'ActionStep', action: 'Click save', expectedResult: '' }
    ]);
  });

  it('returns a shared step reference as its own row, in document order', () => {
    const steps = parseTestSteps(SHARED_STEPS_XML);
    expect(steps.map((s) => [s.identifier, s.type, s.sharedStepId])).toEqual([
      ['1', 'ValidateStep', undefined],
      ['2', 'SharedStepReference', 49],
      ['3', 'ActionStep', undefined]
    ]);
  });

  it('encodes action paths as 8-digit lowercase hex, as the web UI does', () => {
    const xml = '<steps><step id="10" type="ActionStep"><parameterizedString>x</parameterizedString></step></steps>';
    expect(parseTestSteps(xml)[0].actionPath).toBe('0000000a');
  });

  it('returns no steps for empty input', () => {
    expect(parseTestSteps(undefined)).toEqual([]);
  });
});

describe('TestExecutionService', () => {
  let service: TestExecutionService;
  let testApi: Record<string, jest.Mock>;
  let testPlanApi: Record<string, jest.Mock>;
  let releaseApi: Record<string, jest.Mock>;
  let buildApi: Record<string, jest.Mock>;
  let witApi: Record<string, jest.Mock>;

  beforeEach(() => {
    service = new TestExecutionService(testConfig);
    testApi = {
      createTestRun: jest.fn().mockResolvedValue({ id: 77, name: 'run', state: 'InProgress', webAccessUrl: 'https://run/77' }),
      updateTestRun: jest.fn().mockResolvedValue({ id: 77, state: 'Completed' }),
      getTestResults: jest.fn().mockResolvedValue([{ id: 100000, testCase: { id: '5' }, outcome: 'None', state: 'Pending' }]),
      getTestResultById: jest.fn().mockResolvedValue({ id: 100000 }),
      getTestRunById: jest.fn().mockResolvedValue({ id: 77, name: 'run', webAccessUrl: 'https://run/77' }),
      updateTestResults: jest.fn().mockResolvedValue([{ id: 100000, outcome: 'Passed', state: 'Completed' }]),
      getTestResultAttachments: jest.fn().mockResolvedValue([]),
      createTestResultAttachment: jest.fn().mockResolvedValue({ id: 1 }),
      createTestIterationResultAttachment: jest.fn().mockResolvedValue({ id: 2 }),
      createTestRunAttachment: jest.fn().mockResolvedValue({ id: 3 }),
      updateTestPoints: jest.fn().mockResolvedValue([{ id: 9, testCase: { id: '5' } }]),
    };
    testPlanApi = {
      getSuitesByTestCaseId: jest.fn().mockResolvedValue([{ id: 20, plan: { id: 1 } }, { id: 21, plan: { id: 99 } }]),
      getPointsList: jest.fn().mockResolvedValue([{ id: 9, testCaseReference: { id: 5 } }]),
    };
    releaseApi = {
      getReleaseDefinition: jest.fn().mockResolvedValue({
        id: 3,
        environments: [{ id: 11, name: 'Dev' }, { id: 12, name: 'Stage' }],
        artifacts: [{ alias: '_build', type: 'Build', definitionReference: { definition: { id: '8' } } }]
      }),
      createRelease: jest.fn().mockResolvedValue({
        id: 500, name: 'Release-500',
        environments: [{ id: 901, definitionEnvironmentId: 11 }, { id: 902, definitionEnvironmentId: 12 }]
      }),
      updateReleaseEnvironment: jest.fn().mockResolvedValue({}),
    };
    buildApi = {
      getBuild: jest.fn().mockResolvedValue({ id: 42, buildNumber: '20261015.1' }),
      getBuilds: jest.fn().mockResolvedValue([{ id: 43, buildNumber: '20261016.1' }]),
    };
    witApi = {
      getWorkItem: jest.fn().mockResolvedValue({
        id: 5, url: 'https://wi/5', relations: [],
        fields: { 'Microsoft.VSTS.TCM.Steps': STEPS_XML, 'System.Title': 'Save works', 'System.AreaPath': 'Eng\\Area', 'System.IterationPath': 'Eng\\Sprint 1' }
      }),
      createWorkItem: jest.fn().mockResolvedValue({ id: 900, url: 'https://wi/900' }),
      updateWorkItem: jest.fn().mockResolvedValue({}),
    };
    (service as any).getTestApi = jest.fn().mockResolvedValue(testApi);
    (service as any).getTestPlanApi = jest.fn().mockResolvedValue(testPlanApi);
    (service as any).getReleaseApi = jest.fn().mockResolvedValue(releaseApi);
    (service as any).getBuildApi = jest.fn().mockResolvedValue(buildApi);
    (service as any).getWorkItemTrackingApi = jest.fn().mockResolvedValue(witApi);
  });

  const resultWithIteration = (actionResults: unknown[] = []) => ({
    id: 100000,
    testCase: { id: '5' },
    testCaseTitle: 'Save works',
    outcome: 'Failed',
    comment: 'broke',
    iterationDetails: [{ id: 1, outcome: 'None', actionResults }]
  });

  describe('startTestRun', () => {
    it('creates an in-progress manual run for the points of the plan\'s suite only', async () => {
      const result = await service.startTestRun({
        testCaseIds: [5], planId: 1, testType: 'manual', runner: 'webApplication', runName: 'My run'
      });

      expect(testPlanApi.getPointsList).toHaveBeenCalledWith('Engineering', 1, 20, undefined, '5', undefined, undefined, false, false);
      expect(testApi.createTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My run', plan: { id: '1' }, pointIds: [9], automated: false, state: 'InProgress' }),
        'Engineering'
      );
      expect(result.runId).toBe(77);
      expect(result.results).toEqual([expect.objectContaining({ resultId: 100000, testCaseId: 5, pointId: 9 })]);
    });

    it('reports test cases that have no point in the plan', async () => {
      const result = await service.startTestRun({ testCaseIds: [5, 6], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' });
      expect(result.unresolvedTestCaseIds).toEqual([6]);
    });

    it('rejects a mismatched type and runner', async () => {
      await expect(
        service.startTestRun({ testCaseIds: [5], planId: 1, testType: 'manual', runner: 'releaseStage' })
      ).rejects.toThrow("'webApplication'");
      expect(testApi.createTestRun).not.toHaveBeenCalled();
    });

    it('requires build pipeline, release pipeline and stage for automated runs', async () => {
      await expect(
        service.startTestRun({ testCaseIds: [5], planId: 1, testType: 'automated', runner: 'releaseStage' })
      ).rejects.toThrow('buildPipelineId, releasePipelineId, stageName');
    });

    it('deploys only the chosen stage of a release created with every stage manual', async () => {
      await service.startTestRun({
        testCaseIds: [5], planId: 1, testType: 'automated', runner: 'releaseStage',
        buildPipelineId: 8, buildId: 42, releasePipelineId: 3, stageName: 'stage'
      });

      expect(releaseApi.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          definitionId: 3,
          artifacts: [{ alias: '_build', instanceReference: { id: '42', name: '20261015.1' } }],
          manualEnvironments: ['Dev', 'Stage'],
          variables: { 'test.RunId': { value: '77' } }
        }),
        'Engineering'
      );
      expect(releaseApi.updateReleaseEnvironment).toHaveBeenCalledTimes(1);
      expect(releaseApi.updateReleaseEnvironment).toHaveBeenCalledWith(expect.anything(), 'Engineering', 500, 902);
      expect(testApi.updateTestRun).toHaveBeenCalledWith(
        expect.objectContaining({ releaseUri: 'vstfs:///ReleaseManagement/Release/500', releaseEnvironmentUri: 'vstfs:///ReleaseManagement/Environment/902' }),
        'Engineering', 77
      );
    });

    it('uses the latest completed build when no build is given', async () => {
      await service.startTestRun({
        testCaseIds: [5], planId: 1, testType: 'automated', runner: 'releaseStage',
        buildPipelineId: 8, releasePipelineId: 3, stageName: 'Stage'
      });
      expect(releaseApi.createRelease.mock.calls[0][0].artifacts[0].instanceReference.id).toBe('43');
    });

    it('names the available stages when the stage is unknown', async () => {
      await expect(
        service.startTestRun({
          testCaseIds: [5], planId: 1, testType: 'automated', runner: 'releaseStage',
          buildPipelineId: 8, releasePipelineId: 3, stageName: 'Prod'
        })
      ).rejects.toThrow('Available stages: Dev, Stage');
      expect(releaseApi.createRelease).not.toHaveBeenCalled();
    });
  });

  describe('shared steps', () => {
    beforeEach(() => {
      witApi.getWorkItem.mockImplementation(async (id: number) =>
        id === 49
          ? { id: 49, rev: 4, fields: { 'System.Title': 'Login', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML } }
          : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': SHARED_STEPS_XML, 'System.Title': 'Save works' } }
      );
    });

    it('reads a result with the shared set expanded and the web UI\'s recorded outcomes on its steps', async () => {
      testApi.getTestResultById.mockResolvedValue(
        resultWithIteration([
          { actionPath: '00000002', outcome: 'Passed' },
          { actionPath: '0000000200000001', outcome: 'Passed' },
          { actionPath: '0000000200000002', outcome: 'Failed', errorMessage: 'bad password' }
        ])
      );
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(out.steps!.map((s) => [s.stepId, s.type, s.outcome])).toEqual([
        [1, 'ValidateStep', undefined],
        [2, 'SharedStepReference', 'Passed'],
        ['2;1', 'ActionStep', 'Passed'],
        ['2;2', 'ActionStep', 'Failed'],
        [3, 'ActionStep', undefined]
      ]);
      expect(out.steps![1].action).toBe('Shared steps: Login');
      expect(out.steps![3].comment).toBe('bad password');
      expect(out.unmatchedStepResults).toBeUndefined();
    });

    it('marks a step inside a shared set using the parent+child path and records the set revision on the reference', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      await service.setTestStepResults({
        runId: 77, resultId: 100000,
        steps: [{ stepId: '2;2', outcome: 'Failed', comment: 'bad password' }, { stepId: 2, outcome: 'Passed' }]
      });
      const actionResults = testApi.updateTestResults.mock.calls[0][0][0].iterationDetails[0].actionResults;
      expect(actionResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ actionPath: '0000000200000002', stepIdentifier: '2;2', outcome: 'Failed', errorMessage: 'bad password' }),
        expect.objectContaining({ actionPath: '00000002', stepIdentifier: '2', sharedStepModel: { id: 49, revision: 4 } })
      ]));
    });

    it('allStepsOutcome marks the references and every step inside them', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      const out = await service.setTestStepResults({ runId: 77, resultId: 100000, allStepsOutcome: 'Passed' });
      expect(out.stepsUpdated).toBe(5);
      expect(out.iterationOutcome).toBe('Passed');
    });

    it('does not report Passed while steps inside a shared set are unmarked', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      const out = await service.setTestStepResults({
        runId: 77, resultId: 100000, steps: [{ stepId: 1, outcome: 'Passed' }, { stepId: 3, outcome: 'Passed' }]
      });
      expect(out.iterationOutcome).not.toBe('Passed');
    });

    it('attaches to a step inside a shared set through its combined path', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      await service.addTestResultAttachment({ runId: 77, resultId: 100000, base64Content: 'aGk=', fileName: 'x.txt', stepId: '2;1' });
      expect(testApi.createTestIterationResultAttachment).toHaveBeenCalledWith(expect.anything(), 'Engineering', 77, 100000, 1, '0000000200000001');
    });

    it('lists the identifiers when a step is not found', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      await expect(
        service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: '2;9', outcome: 'Passed' }] })
      ).rejects.toThrow('Steps: 1, 2, 2;1, 2;2, 3');
    });
  });

  describe('getTestResult', () => {
    it('surfaces step outcomes recorded under a path no listed step maps to', async () => {
      testApi.getTestResultById.mockResolvedValue(
        resultWithIteration([
          { actionPath: '00000002', outcome: 'Passed' },
          { actionPath: '00000010', outcome: 'Failed', errorMessage: 'in shared step' }
        ])
      );
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(out.steps![0]).toEqual(expect.objectContaining({ stepId: 2, outcome: 'Passed' }));
      expect(out.unmatchedStepResults).toEqual([{ actionPath: '00000010', outcome: 'Failed', comment: 'in shared step' }]);
    });
  });

  describe('setTestStepResults', () => {
    it('marks selected steps and keeps outcomes already recorded', async () => {
      testApi.getTestResultById.mockResolvedValue(
        resultWithIteration([{ actionPath: '00000002', iterationId: 1, outcome: 'Passed' }])
      );
      const out = await service.setTestStepResults({
        runId: 77, resultId: 100000, steps: [{ stepId: 3, outcome: 'Failed', comment: 'Save button missing' }]
      });

      const sent = testApi.updateTestResults.mock.calls[0][0][0];
      expect(sent.id).toBe(100000);
      expect(sent.iterationDetails[0].actionResults).toEqual([
        expect.objectContaining({ actionPath: '00000002', outcome: 'Passed' }),
        expect.objectContaining({ actionPath: '00000003', stepIdentifier: '3', outcome: 'Failed', errorMessage: 'Save button missing' })
      ]);
      expect(out.iterationOutcome).toBe('Failed');
    });

    it('marks every step and reports Passed when all pass', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      const out = await service.setTestStepResults({ runId: 77, resultId: 100000, allStepsOutcome: 'Passed' });
      expect(out.stepsUpdated).toBe(2);
      expect(out.iterationOutcome).toBe('Passed');
    });

    it('rejects an unknown step id', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      await expect(
        service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 99, outcome: 'Passed' }] })
      ).rejects.toThrow('Step 99 not found');
      expect(testApi.updateTestResults).not.toHaveBeenCalled();
    });

    it('requires something to mark', async () => {
      await expect(service.setTestStepResults({ runId: 77, resultId: 100000 })).rejects.toThrow('steps and/or allStepsOutcome');
    });
  });

  describe('setTestResultOutcome', () => {
    it('completes the result for a final outcome', async () => {
      await service.setTestResultOutcome({ runId: 77, resultId: 100000, outcome: 'Blocked', comment: 'env down' });
      expect(testApi.updateTestResults.mock.calls[0][0][0]).toEqual(
        expect.objectContaining({ id: 100000, outcome: 'Blocked', state: 'Completed', comment: 'env down' })
      );
    });

    it('leaves a paused result unfinished', async () => {
      await service.setTestResultOutcome({ runId: 77, resultId: 100000, outcome: 'Paused' });
      const sent = testApi.updateTestResults.mock.calls[0][0][0];
      expect(sent.state).toBe('Paused');
      expect(sent.completedDate).toBeUndefined();
    });
  });

  describe('attachments', () => {
    let tmpDir: string;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-exec-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uploads a screenshot as base64', async () => {
      const file = path.join(tmpDir, 'shot.png');
      fs.writeFileSync(file, 'png-bytes');
      await service.addTestResultAttachment({ runId: 77, resultId: 100000, filePath: file, kind: 'screenshot', comment: 'on failure' });

      expect(testApi.createTestResultAttachment).toHaveBeenCalledWith(
        { attachmentType: 'GeneralAttachment', comment: 'on failure', fileName: 'shot.png', stream: Buffer.from('png-bytes').toString('base64') },
        'Engineering', 77, 100000
      );
    });

    it('rejects a recording that is not a video', async () => {
      const file = path.join(tmpDir, 'shot.png');
      fs.writeFileSync(file, 'x');
      await expect(
        service.addTestResultAttachment({ runId: 77, resultId: 100000, filePath: file, kind: 'recording' })
      ).rejects.toThrow('must be a video');
      expect(testApi.createTestResultAttachment).not.toHaveBeenCalled();
    });

    it('attaches to a step through the iteration attachment API', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      const file = path.join(tmpDir, 'log.txt');
      fs.writeFileSync(file, 'log');
      await service.addTestResultAttachment({ runId: 77, resultId: 100000, filePath: file, stepId: 3 });
      expect(testApi.createTestIterationResultAttachment).toHaveBeenCalledWith(expect.anything(), 'Engineering', 77, 100000, 1, '00000003');
    });

    it('uploads a run attachment', async () => {
      await service.addTestRunAttachment({ runId: 77, base64Content: 'aGk=', fileName: 'notes.txt' });
      expect(testApi.createTestRunAttachment).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'notes.txt', stream: 'aGk=' }), 'Engineering', 77);
    });

    it('fails for a missing file', async () => {
      await expect(
        service.addTestRunAttachment({ runId: 77, filePath: path.join(tmpDir, 'nope.png') })
      ).rejects.toThrow('File not found');
    });
  });

  describe('result comment and analysis', () => {
    it('appends to the existing comment by default', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, comment: 'first' });
      await service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'second' });
      expect(testApi.updateTestResults.mock.calls[0][0][0].comment).toBe('first\nsecond');
    });

    it('replaces the comment when asked', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, comment: 'old' });
      await service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'only', replace: true });
      expect(testApi.updateTestResults.mock.calls[0][0][0].comment).toBe('only');
    });

    // Azure DevOps resets failureType/resolution on any update that doesn't send them.
    describe('keeping the failure analysis across updates', () => {
      const analysed = { id: 100000, comment: 'c', failureType: 'Regression', resolutionStateId: 10, resolutionState: 'Test issue' };
      const sent = () => testApi.updateTestResults.mock.calls[0][0][0];

      it('re-sends it when a comment is added', async () => {
        testApi.getTestResultById.mockResolvedValue(analysed);
        await service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'more' });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionStateId: 10, comment: 'c\nmore' }));
      });

      it('re-sends it when the outcome is set', async () => {
        testApi.getTestResultById.mockResolvedValue(analysed);
        await service.setTestResultOutcome({ runId: 77, resultId: 100000, outcome: 'Failed' });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionStateId: 10, outcome: 'Failed' }));
      });

      it('re-sends it when steps are marked', async () => {
        testApi.getTestResultById.mockResolvedValue({ ...resultWithIteration(), failureType: 'Regression', resolutionStateId: 10 });
        await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 2, outcome: 'Passed' }] });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionStateId: 10 }));
      });

      it('re-sends it when work items are linked', async () => {
        testApi.getTestResultById.mockResolvedValue(analysed);
        await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12], addRunHyperlink: false });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionStateId: 10 }));
      });

      it('keeps the resolution when only the failure type is changed, and vice versa', async () => {
        testApi.getTestResultById.mockResolvedValue(analysed);
        await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, failureType: 'Known Issue' });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Known Issue', resolutionStateId: 10 }));
        testApi.updateTestResults.mockClear();
        await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, resolutionStateId: 11 });
        expect(sent()).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionStateId: 11 }));
      });

      it('finds the resolution id by name when the result only reports the name', async () => {
        (service as any).connection.rest = {
          get: jest.fn().mockResolvedValue({ statusCode: 200, result: { value: [{ id: 10, name: 'Test issue' }] } })
        };
        testApi.getTestResultById.mockResolvedValue({ id: 100000, comment: 'c', failureType: 'None', resolutionState: 'Test Issue' });
        await service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'more' });
        expect(sent().resolutionStateId).toBe(10);
        expect(sent().failureType).toBeUndefined();
      });

      it('sends nothing extra for a result with no analysis', async () => {
        testApi.getTestResultById.mockResolvedValue({ id: 100000, failureType: 'None' });
        await service.setTestResultOutcome({ runId: 77, resultId: 100000, outcome: 'Passed' });
        expect(sent().failureType).toBeUndefined();
        expect(sent().resolutionStateId).toBeUndefined();
      });
    });

    describe('resolution states', () => {
      let restGet: jest.Mock;
      beforeEach(() => {
        restGet = jest.fn().mockResolvedValue({
          statusCode: 200,
          result: { value: [{ id: 9, name: 'Needs investigation' }, { id: 11, name: 'Product issue' }] }
        });
        (service as any).connection.rest = { get: restGet };
      });

      it('lists the project resolution states from the TCMServiceMigration route', async () => {
        const states = await service.listTestResolutionStates();
        expect(states).toEqual([{ id: 9, name: 'Needs investigation' }, { id: 11, name: 'Product issue' }]);
        expect(restGet).toHaveBeenCalledWith(
          'https://dev.azure.com/selerix/Engineering/_apis/TCMServiceMigration/testresolutionstate?api-version=7.1-preview.1'
        );
      });

      it('stores the resolution by looked-up id (name match is case-insensitive) and reads the analysis back', async () => {
        testApi.getTestResultById.mockResolvedValue({ id: 100000, failureType: 'Regression', resolutionState: 'Product issue' });
        const out = await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, failureType: 'Regression', resolutionState: 'PRODUCT ISSUE' });
        const sent = testApi.updateTestResults.mock.calls[0][0][0];
        expect(sent).toEqual(expect.objectContaining({ id: 100000, failureType: 'Regression', resolutionStateId: 11 }));
        expect(sent.resolutionState).toBeUndefined();
        expect(out).toEqual(expect.objectContaining({ failureType: 'Regression', resolutionState: 'Product issue' }));
      });

      it('uses an explicit resolutionStateId without any lookup', async () => {
        testApi.getTestResultById.mockResolvedValue({ id: 100000 });
        await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, resolutionStateId: 10 });
        expect(restGet).not.toHaveBeenCalled();
        expect(testApi.updateTestResults.mock.calls[0][0][0].resolutionStateId).toBe(10);
      });

      it('names the available states when the name is unknown', async () => {
        await expect(
          service.updateTestResultAnalysis({ runId: 77, resultId: 100000, resolutionState: 'Whatever' })
        ).rejects.toThrow("Unknown resolution state 'Whatever'. Available: Needs investigation, Product issue");
        expect(testApi.updateTestResults).not.toHaveBeenCalled();
      });

      it('fails clearly when the states cannot be read', async () => {
        restGet.mockResolvedValue({ statusCode: 404, result: null });
        await expect(service.listTestResolutionStates()).rejects.toThrow('pass resolutionStateId');
      });
    });

    it('requires at least one analysis field', async () => {
      await expect(service.updateTestResultAnalysis({ runId: 77, resultId: 100000 })).rejects.toThrow('at least one');
    });
  });

  describe('points', () => {
    it('assigns the tester per suite', async () => {
      await service.assignTester({ planId: 1, testCaseIds: [5], tester: { id: 'guid-1', displayName: 'Pat Tester' } });
      expect(testApi.updateTestPoints).toHaveBeenCalledWith(
        { tester: { id: 'guid-1', uniqueName: undefined, displayName: 'Pat Tester' } }, 'Engineering', 1, 20, '9'
      );
    });

    it('requires a tester identity', async () => {
      await expect(service.assignTester({ planId: 1, testCaseIds: [5], tester: {} })).rejects.toThrow('tester needs');
    });

    it('resets points to active', async () => {
      await service.resetTestToActive({ planId: 1, testCaseIds: [5] });
      expect(testApi.updateTestPoints).toHaveBeenCalledWith({ resetToActive: true }, 'Engineering', 1, 20, '9');
    });

    it('fails when the test case is not in the plan', async () => {
      testPlanApi.getSuitesByTestCaseId.mockResolvedValue([{ id: 21, plan: { id: 99 } }]);
      await expect(service.resetTestToActive({ planId: 1, testCaseIds: [5] })).rejects.toThrow('No test points found');
    });
  });

  describe('linkTestRunToWorkItems', () => {
    it('merges with bugs already associated and adds one run hyperlink', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, associatedBugs: [{ id: '11' }] });
      const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });

      expect(testApi.updateTestResults.mock.calls[0][0]).toEqual([{ id: 100000, associatedBugs: [{ id: '11' }, { id: '12' }] }]);
      expect(witApi.updateWorkItem.mock.calls[0][1][0].value).toEqual(expect.objectContaining({ rel: 'Hyperlink', url: 'https://run/77' }));
      expect(out.hyperlinked).toEqual([12]);
    });

    it('does not duplicate an existing hyperlink', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000 });
      witApi.getWorkItem.mockResolvedValue({ relations: [{ rel: 'Hyperlink', url: 'https://run/77' }] });
      const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });
      expect(witApi.updateWorkItem).not.toHaveBeenCalled();
      expect(out.hyperlinked).toEqual([]);
    });

    it('links every result when no resultId is given', async () => {
      testApi.getTestResults.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      testApi.getTestResultById.mockResolvedValue({});
      const out = await service.linkTestRunToWorkItems({ runId: 77, workItemIds: [12], addRunHyperlink: false });
      expect(out.resultsLinked).toEqual([1, 2]);
    });
  });

  describe('bugs', () => {
    beforeEach(() => {
      testApi.getTestResultById.mockResolvedValue(
        resultWithIteration([{ actionPath: '00000003', outcome: 'Failed', errorMessage: 'Save button <missing>' }])
      );
      testApi.getTestResultAttachments.mockResolvedValue([{ id: 1, fileName: 'shot.png', url: 'https://att/1' }]);
    });

    it('creates a bug with repro steps, defaulted paths and links', async () => {
      const out = await service.createBugFromTestRun({ runId: 77, resultId: 100000, severity: '2 - High' });

      const [, patch, project, type] = witApi.createWorkItem.mock.calls[0];
      expect(project).toBe('Engineering');
      expect(type).toBe('Bug');
      const field = (name: string) => patch.find((p: any) => p.path === `/fields/${name}`)?.value;
      expect(field('System.Title')).toBe('Save works failed');
      expect(field('System.AreaPath')).toBe('Eng\\Area');
      expect(field('Microsoft.VSTS.Common.Severity')).toBe('2 - High');
      const repro = field('Microsoft.VSTS.TCM.ReproSteps');
      expect(repro).toContain('Click save <b>[FAILED]</b>');
      expect(repro).toContain('Save button &lt;missing&gt;');
      expect(repro).toContain('shot.png');
      const rels = patch.filter((p: any) => p.path === '/relations/-').map((p: any) => p.value);
      expect(rels.map((r: any) => r.rel)).toEqual(['ArtifactLink', 'Hyperlink', 'Microsoft.VSTS.Common.TestedBy-Forward']);
      expect(rels[0].url).toBe('vstfs:///TestManagement/TcmResult/77.100000');
      // the new bug is also recorded on the result
      expect(testApi.updateTestResults.mock.calls[0][0]).toEqual([{ id: 100000, associatedBugs: [{ id: '900' }] }]);
      expect(out.bugId).toBe(900);
    });

    it('comments on an existing bug without duplicating links it already has', async () => {
      witApi.getWorkItem.mockImplementation(async (id: number) =>
        id === 700
          ? { id: 700, fields: { 'Microsoft.VSTS.TCM.ReproSteps': '<p>old</p>' }, relations: [{ rel: 'ArtifactLink', url: 'vstfs:///TestManagement/TcmResult/77.100000' }] }
          : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': STEPS_XML, 'System.Title': 'Save works' } }
      );
      await service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000, appendToReproSteps: true });

      const patch = witApi.updateWorkItem.mock.calls[0][1];
      expect(patch.find((p: any) => p.path === '/fields/System.History').value).toContain('Save works');
      expect(patch.find((p: any) => p.path === '/fields/Microsoft.VSTS.TCM.ReproSteps').value).toMatch(/^<p>old<\/p><hr\/>/);
      const rels = patch.filter((p: any) => p.path === '/relations/-').map((p: any) => p.value.rel);
      expect(rels).toEqual(['Hyperlink', 'Microsoft.VSTS.Common.TestedBy-Forward']);
    });
  });

  describe('history', () => {
    it('maps test case execution history', async () => {
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [{ id: 1, outcome: 'Failed', testRun: { id: '77', name: 'run' }, associatedBugs: [{ id: '9' }] }]
      });
      const out = await service.getTestCaseExecutionHistory({ testCaseId: 5, top: 10 });
      expect(testApi.getTestResultsByQuery.mock.calls[0][0].resultsFilter).toEqual(
        expect.objectContaining({ testCaseId: 5, resultsCount: 10 })
      );
      expect(out.executions[0]).toEqual(expect.objectContaining({ runId: 77, outcome: 'Failed', associatedBugs: [9] }));
    });
  });
});
