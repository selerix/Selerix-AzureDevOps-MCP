import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
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
      getBuild: jest.fn().mockResolvedValue({ id: 42, buildNumber: '20261015.1', definition: { id: 8 } }),
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
      expect(testApi.createTestRun).not.toHaveBeenCalled();
    });

    describe('choosing the release artifact', () => {
      const automated = {
        testCaseIds: [5], planId: 1, testType: 'automated' as const, runner: 'releaseStage' as const,
        buildPipelineId: 8, buildId: 42, releasePipelineId: 3, stageName: 'Stage'
      };
      const buildArtifact = (alias: string, pipelineId: string, name = `pipeline ${pipelineId}`) =>
        ({ alias, type: 'Build', definitionReference: { definition: { id: pipelineId, name } } });
      const withArtifacts = (artifacts: unknown[]) =>
        releaseApi.getReleaseDefinition.mockResolvedValue({ id: 3, environments: [{ id: 12, name: 'Stage' }], artifacts });

      it('does not fall back to a Build artifact of a different pipeline', async () => {
        withArtifacts([buildArtifact('_other', '99', 'Other build')]);
        await expect(service.startTestRun(automated)).rejects.toThrow(
          'has no Build artifact from build pipeline 8. Artifacts: _other (Build, Other build)'
        );
        expect(testApi.createTestRun).not.toHaveBeenCalled();
        expect(releaseApi.createRelease).not.toHaveBeenCalled();
      });

      it('rejects an explicit alias that belongs to a different pipeline', async () => {
        withArtifacts([buildArtifact('_build', '8'), buildArtifact('_other', '99')]);
        await expect(service.startTestRun({ ...automated, artifactAlias: '_other' })).rejects.toThrow(
          "Artifact '_other' is not a Build artifact of build pipeline 8"
        );
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('rejects an explicit alias that is not a Build artifact', async () => {
        withArtifacts([buildArtifact('_build', '8'), { alias: '_pkg', type: 'Package', definitionReference: {} }]);
        await expect(service.startTestRun({ ...automated, artifactAlias: '_pkg' })).rejects.toThrow('is not a Build artifact');
      });

      it('rejects an alias the release pipeline does not have', async () => {
        await expect(service.startTestRun({ ...automated, artifactAlias: '_nope' })).rejects.toThrow("has no artifact '_nope'");
      });

      it('asks for an alias when several Build artifacts come from the requested pipeline', async () => {
        withArtifacts([buildArtifact('_a', '8'), buildArtifact('_b', '8')]);
        await expect(service.startTestRun(automated)).rejects.toThrow('several Build artifacts from build pipeline 8 (_a, _b); pass artifactAlias');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('accepts an alias that picks one of several matching artifacts', async () => {
        withArtifacts([buildArtifact('_a', '8'), buildArtifact('_b', '8')]);
        await service.startTestRun({ ...automated, artifactAlias: '_b' });
        expect(releaseApi.createRelease.mock.calls[0][0].artifacts[0].alias).toBe('_b');
      });

      it('picks the artifact of the requested pipeline among several', async () => {
        withArtifacts([buildArtifact('_other', '99'), buildArtifact('_mine', '8')]);
        await service.startTestRun(automated);
        expect(releaseApi.createRelease.mock.calls[0][0].artifacts[0].alias).toBe('_mine');
      });
    });

    describe('failures while launching an automated run', () => {
      const automated = {
        testCaseIds: [5], planId: 1, testType: 'automated' as const, runner: 'releaseStage' as const,
        buildPipelineId: 8, buildId: 42, releasePipelineId: 3, stageName: 'Stage'
      };

      it('creates no run when the release service cannot be reached (e.g. a TLS failure)', async () => {
        releaseApi.getReleaseDefinition.mockRejectedValue(new Error('unable to get local issuer certificate'));
        await expect(service.startTestRun(automated)).rejects.toThrow('local issuer certificate');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('creates no run when the build does not exist', async () => {
        buildApi.getBuild.mockRejectedValue(new Error('build 42 not found'));
        await expect(service.startTestRun(automated)).rejects.toThrow('build 42 not found');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('rejects an explicit build id that belongs to a different pipeline, before creating a run', async () => {
        buildApi.getBuild.mockResolvedValue({ id: 42, buildNumber: '1.0', definition: { id: 99 } });
        await expect(service.startTestRun(automated)).rejects.toThrow('Build 42 belongs to build pipeline 99, not 8');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
        expect(releaseApi.createRelease).not.toHaveBeenCalled();
      });

      it('rejects a build whose pipeline cannot be confirmed', async () => {
        buildApi.getBuild.mockResolvedValue({ id: 42, buildNumber: '1.0' });
        await expect(service.startTestRun(automated)).rejects.toThrow('Could not confirm that build 42 belongs to build pipeline 8');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('accepts an explicit build id of the requested pipeline', async () => {
        await service.startTestRun(automated);
        expect(releaseApi.createRelease.mock.calls[0][0].artifacts[0].instanceReference).toEqual({ id: '42', name: '20261015.1' });
      });

      it('creates no run when the release pipeline has no build artifact', async () => {
        releaseApi.getReleaseDefinition.mockResolvedValue({ id: 3, environments: [{ id: 12, name: 'Stage' }], artifacts: [] });
        await expect(service.startTestRun(automated)).rejects.toThrow('has no Build artifact from build pipeline 8. Artifacts: none');
        expect(testApi.createTestRun).not.toHaveBeenCalled();
      });

      it('aborts the run and names its id when the release cannot be created', async () => {
        releaseApi.createRelease.mockRejectedValue(new Error('403 forbidden'));
        await expect(service.startTestRun(automated)).rejects.toThrow(
          'Could not create the release for test run 77: 403 forbidden. Test run 77 was marked Aborted.'
        );
        expect(testApi.updateTestRun).toHaveBeenCalledWith(expect.objectContaining({ state: 'Aborted' }), 'Engineering', 77);
      });

      it('says so when the run could not be aborted either', async () => {
        releaseApi.createRelease.mockRejectedValue(new Error('403 forbidden'));
        testApi.updateTestRun.mockRejectedValue(new Error('nope'));
        await expect(service.startTestRun(automated)).rejects.toThrow('could not be aborted; abort it manually');
      });

      it('names the release and leaves everything in place when the stage cannot be started', async () => {
        releaseApi.updateReleaseEnvironment.mockRejectedValue(new Error('approval pending'));
        await expect(service.startTestRun(automated)).rejects.toThrow(
          'Release 500 was created for test run 77 but could not start the stage: approval pending. Nothing was undone; test run 77 is still NotStarted.'
        );
        expect(testApi.updateTestRun).not.toHaveBeenCalled();
      });

      it('names the release when linking it to the run fails after the stage started', async () => {
        testApi.updateTestRun.mockRejectedValue(new Error('conflict'));
        await expect(service.startTestRun(automated)).rejects.toThrow('Release 500 was created for test run 77 but could not link the release to the test run: conflict');
      });
    });
  });

  describe('overlapping edits of the same result', () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let store: any;

    beforeEach(() => {
      // A tiny stand-in for the result on the server. Reads and writes take time, so two calls
      // that are not serialised both read the same starting state. Like Azure DevOps, an update
      // that does not carry failureType resets it.
      store = { id: 100000, testCase: { id: '5' }, comment: 'start', failureType: 'None', iterationDetails: [{ id: 1, actionResults: [] }] };
      testApi.getTestResultById.mockImplementation(async () => {
        await delay(10);
        return JSON.parse(JSON.stringify(store));
      });
      testApi.updateTestResults.mockImplementation(async (updates: any[]) => {
        await delay(10);
        for (const u of updates) {
          if (u.comment !== undefined) store.comment = u.comment;
          store.failureType = u.failureType ?? 'None';
          if (u.iterationDetails) store.iterationDetails = u.iterationDetails;
        }
        return [JSON.parse(JSON.stringify(store))];
      });
    });

    it('keeps both comments when two are added at once', async () => {
      await Promise.all([
        service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'first' }),
        service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'second' })
      ]);
      expect(store.comment.split('\n').sort()).toEqual(['first', 'second', 'start']);
    });

    it('keeps both the new comment and the new failure analysis', async () => {
      await Promise.all([
        service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'more' }),
        service.updateTestResultAnalysis({ runId: 77, resultId: 100000, failureType: 'Regression' })
      ]);
      expect(store.comment).toContain('more');
      expect(store.failureType).toBe('Regression');
    });

    it('keeps the outcomes of both step updates', async () => {
      await Promise.all([
        service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 2, outcome: 'Passed' }] }),
        service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 3, outcome: 'Failed', comment: 'broke' }] })
      ]);
      const recorded = store.iterationDetails[0].actionResults.map((a: any) => [a.actionPath, a.outcome]).sort();
      expect(recorded).toEqual([['00000002', 'Passed'], ['00000003', 'Failed']]);
    });

    it('runs the edits one after another, not side by side', async () => {
      let inFlight = 0;
      let peak = 0;
      const read = testApi.getTestResultById.getMockImplementation()!;
      testApi.getTestResultById.mockImplementation(async (...args: unknown[]) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        try { return await read(...args); } finally { inFlight--; }
      });
      await Promise.all(['a', 'b', 'c'].map((c) => service.addTestResultComment({ runId: 77, resultId: 100000, comment: c })));
      expect(peak).toBe(1);
    });

    it('lets edits of different results run side by side', async () => {
      let inFlight = 0;
      let peak = 0;
      const read = testApi.getTestResultById.getMockImplementation()!;
      testApi.getTestResultById.mockImplementation(async (...args: unknown[]) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        try { return await read(...args); } finally { inFlight--; }
      });
      await Promise.all([
        service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'a' }),
        service.addTestResultComment({ runId: 77, resultId: 100001, comment: 'b' }),
        service.addTestResultComment({ runId: 78, resultId: 100000, comment: 'c' })
      ]);
      expect(peak).toBe(3);
    });

    it('releases the lock when an edit fails, so the next one proceeds', async () => {
      const write = testApi.updateTestResults.getMockImplementation()!;
      testApi.updateTestResults.mockRejectedValueOnce(new Error('server error'));
      const failing = service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'lost' });
      const next = service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'kept' });
      await expect(failing).rejects.toThrow('server error');
      await next;
      expect(store.comment).toBe('start\nkept');
      expect(write).toBeDefined();
      expect((service as any).resultLocks.size).toBe(0);
    });

    it('serialises linking a result with another edit of it', async () => {
      await Promise.all([
        service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'note' }),
        service.updateTestResultAnalysis({ runId: 77, resultId: 100000, failureType: 'Regression' }),
        service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12], addRunHyperlink: false })
      ]);
      expect(store.comment).toContain('note');
      expect(store.failureType).toBe('Regression');
    });
  });

  describe('a manual run whose results cannot be read after it was created', () => {
    it('names the new run and says not to start it again', async () => {
      testApi.getTestResults.mockRejectedValue(new Error('service unavailable'));
      await expect(
        service.startTestRun({ testCaseIds: [5], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' })
      ).rejects.toThrow(
        'Test run 77 was created but its results could not be read: service unavailable. Do not start the run again; read its results with getTestRuns (runId 77).'
      );
      expect(testApi.createTestRun).toHaveBeenCalledTimes(1);
    });
  });

  describe('runs with more results than one page', () => {
    // results come back 500 at a time (skip/top)
    const results = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: from + i, testCase: { id: '5' }, testPoint: { id: '9' } }));
    const twoPages = () =>
      testApi.getTestResults.mockImplementation(async (_p: string, _r: number, _d: unknown, skip: number) =>
        skip === 0 ? results(1, 500) : results(501, 3));

    it('startTestRun reports the results of every page', async () => {
      twoPages();
      const out = await service.startTestRun({ testCaseIds: [5], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' });
      expect(out.results).toHaveLength(503);
      expect(testApi.getTestResults.mock.calls.map((c) => c[3])).toEqual([0, 500]);
    });

    it('getTestRuns with a run id lists the results of every page', async () => {
      twoPages();
      const out = await service.getTestRuns({ runId: 77 });
      expect(out.results).toHaveLength(503);
    });

    it('links every result of a large run, in bounded batches', async () => {
      twoPages();
      const out = await service.linkTestRunToWorkItems({ runId: 77, workItemIds: [12], addRunHyperlink: false });

      expect(out.resultsLinked).toHaveLength(503);
      // every result is updated, none twice, and no request carries more than 50
      const batches = testApi.updateTestResults.mock.calls.map((c) => c[0] as { id: number }[]);
      expect(batches.every((b) => b.length <= 50)).toBe(true);
      expect(batches).toHaveLength(11);
      expect(new Set(batches.flat().map((u) => u.id)).size).toBe(503);
      // each result is read again under its lock, with the work items it has right now
      expect(testApi.getTestResultById).toHaveBeenCalledTimes(503);
    });

    it('keeps the bugs a result already has when linking a whole run', async () => {
      testApi.getTestResults.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      testApi.getTestResultById.mockImplementation(async (_p: string, _r: number, id: number) =>
        id === 1 ? { id: 1, associatedBugs: [{ id: '11' }] } : { id: 2 });
      await service.linkTestRunToWorkItems({ runId: 77, workItemIds: [12], addRunHyperlink: false });
      expect(testApi.updateTestResults.mock.calls[0][0]).toEqual([
        expect.objectContaining({ id: 1, associatedBugs: [{ id: '11' }, { id: '12' }] }),
        expect.objectContaining({ id: 2, associatedBugs: [{ id: '12' }] })
      ]);
    });

    describe('history enrichment', () => {
      const historyOf = (runIds: number[]) => ({
        results: runIds.map((id, i) => ({ id: 100000, outcome: 'Failed', testPoint: { id: '9' }, testRun: { id: String(id) }, completedDate: i }))
      });

      it('looks up every run, however many, and reports the bugs of the last one too', async () => {
        const runIds = Array.from({ length: 30 }, (_, i) => 2000 + i);
        testApi.getTestResultsByQuery = jest.fn().mockResolvedValue(historyOf(runIds));
        testApi.getTestRunById.mockImplementation(async (_p: string, id: number) => ({ id, name: `run ${id}` }));
        testApi.getTestResults.mockImplementation(async (_p: string, id: number) =>
          [{ id: 100000, associatedBugs: id === 2029 ? [{ id: '23256' }] : [] }]);

        const out = await service.getTestCaseExecutionHistory({ testCaseId: 5, top: 30 });
        expect(testApi.getTestRunById).toHaveBeenCalledTimes(30);
        expect(out.executions[29]).toEqual(expect.objectContaining({ runName: 'run 2029', associatedBugs: [23256] }));
        expect(out.runsNotLookedUp).toBeUndefined();
      });

      it('looks runs up a few at a time, not all at once', async () => {
        const runIds = Array.from({ length: 20 }, (_, i) => 3000 + i);
        testApi.getTestResultsByQuery = jest.fn().mockResolvedValue(historyOf(runIds));
        let inFlight = 0;
        let peak = 0;
        testApi.getTestRunById.mockImplementation(async (_p: string, id: number) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          return { id, name: `run ${id}` };
        });
        testApi.getTestResults.mockResolvedValue([]);
        await service.getTestCaseExecutionHistory({ testCaseId: 5, top: 20 });
        expect(peak).toBeLessThanOrEqual(5);
        expect(peak).toBeGreaterThan(1);
      });

      it('says a run was not looked up instead of reporting an empty bug list for it', async () => {
        testApi.getTestResultsByQuery = jest.fn().mockResolvedValue(historyOf([77, 78]));
        testApi.getTestRunById.mockImplementation(async (_p: string, id: number) => {
          if (id === 77) throw new Error('run unavailable');
          return { id, name: 'run 78' };
        });
        testApi.getTestResults.mockResolvedValue([{ id: 100000, associatedBugs: [{ id: '9' }] }]);

        const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });
        expect(out.runsNotLookedUp).toEqual([77]);
        expect(out.executions[0].associatedBugs).toBeUndefined();
        expect(out.executions[0].runName).toBeUndefined();
        expect(out.executions[1].associatedBugs).toEqual([9]);
      });

      it('keeps the bugs the query itself reported for a run that was not looked up', async () => {
        testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
          results: [{ id: 100000, outcome: 'Failed', testPoint: { id: '9' }, testRun: { id: '77' }, associatedBugs: [{ id: '5' }] }]
        });
        testApi.getTestRunById.mockRejectedValue(new Error('run unavailable'));
        const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });
        expect(out.executions[0].associatedBugs).toEqual([5]);
      });

      it('getTestPoints history reports runs it could not look up', async () => {
        testPlanApi.getPointsList.mockResolvedValue([{ id: 9, testCaseReference: { id: 5, name: 'Save works' } }]);
        testApi.getTestResultsByQuery = jest.fn().mockResolvedValue(historyOf([77]));
        testApi.getTestRunById.mockRejectedValue(new Error('run unavailable'));
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true });
        expect(out.historyRunsNotLookedUp).toEqual([77]);
        expect((out.points[0].history as { associatedBugs?: number[] }[])[0].associatedBugs).toBeUndefined();
      });
    });

    it('asks for at most 200 results per page when details are requested, and treats only a short page as the last', async () => {
      // Azure DevOps caps a detailed page at 200: a full 200-result page must be followed by another request
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [{ id: 450, outcome: 'Failed', testPoint: { id: '9' }, testRun: { id: '77' } }]
      });
      // result 450 is on the third page (after 400 results)
      testApi.getTestResults.mockImplementation(async (_p: string, _r: number, _d: unknown, skip: number) =>
        skip === 0 ? results(1, 200) : skip === 200 ? results(201, 200) : [{ id: 450, associatedBugs: [{ id: '777' }] }]);

      const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });

      expect(testApi.getTestResults.mock.calls.map((c) => [c[3], c[4]])).toEqual([[0, 200], [200, 200], [400, 200]]);
      expect(out.executions[0].associatedBugs).toEqual([777]);
    });

    it('still reads plain result lists 500 at a time', async () => {
      testApi.getTestResults.mockImplementation(async (_p: string, _r: number, _d: unknown, skip: number) =>
        skip === 0 ? results(1, 500) : []);
      await service.getTestRuns({ runId: 77 });
      expect(testApi.getTestResults.mock.calls.map((c) => [c[3], c[4]])).toEqual([[0, 500], [500, 500]]);
    });

    it('finds the bugs of results on later pages when enriching history', async () => {
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [{ id: 600, outcome: 'Failed', testPoint: { id: '9' }, testRun: { id: '77' } }]
      });
      testApi.getTestResults.mockImplementation(async (_p: string, _r: number, _d: unknown, skip: number) =>
        skip === 0 ? results(1, 200) : [{ id: 600, associatedBugs: [{ id: '23256' }] }]);
      const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });
      expect(out.executions[0].associatedBugs).toEqual([23256]);
    });
  });

  describe('result point ids when a test case has several points', () => {
    it('takes each result\'s own point id instead of the last point of the case', async () => {
      testPlanApi.getPointsList.mockResolvedValue([
        { id: 9, testCaseReference: { id: 5 } }, { id: 10, testCaseReference: { id: 5 } }
      ]);
      testApi.getTestResults.mockResolvedValue([
        { id: 100000, testCase: { id: '5' }, testPoint: { id: '9' } },
        { id: 100001, testCase: { id: '5' }, testPoint: { id: '10' } }
      ]);
      const out = await service.startTestRun({ testCaseIds: [5], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' });
      expect(out.results.map((r) => [r.resultId, r.pointId])).toEqual([[100000, 9], [100001, 10]]);
    });

    it('infers the point from the test case only when it has exactly one', async () => {
      testPlanApi.getPointsList.mockResolvedValue([{ id: 9, testCaseReference: { id: 5 } }]);
      testApi.getTestResults.mockResolvedValue([{ id: 100000, testCase: { id: '5' } }]);
      const one = await service.startTestRun({ testCaseIds: [5], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' });
      expect(one.results[0].pointId).toBe(9);

      testPlanApi.getPointsList.mockResolvedValue([
        { id: 9, testCaseReference: { id: 5 } }, { id: 10, testCaseReference: { id: 5 } }
      ]);
      const many = await service.startTestRun({ testCaseIds: [5], planId: 1, suiteId: 20, testType: 'manual', runner: 'webApplication' });
      expect(many.results[0].pointId).toBeUndefined();
    });
  });

  describe('steps as they were when the result was run', () => {
    // The test case was edited after the run: revision 3 had steps 2 and 3, the latest has "Latest only" too.
    const OLD_STEPS = STEPS_XML;
    const LATEST_STEPS = STEPS_XML.replace('</steps>',
      '<step id="4" type="ActionStep"><parameterizedString isformatted="true">Latest only</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step></steps>');
    const ranAtRevision = (extra: Record<string, unknown> = {}, actionResults: unknown[] = []) =>
      ({ ...resultWithIteration(actionResults), testCaseRevision: 3, ...extra });

    beforeEach(() => {
      witApi.getWorkItem.mockResolvedValue({ id: 5, url: 'https://wi/5', rev: 5, fields: { 'Microsoft.VSTS.TCM.Steps': LATEST_STEPS, 'System.Title': 'Save works' } });
      witApi.getRevision = jest.fn().mockResolvedValue({ id: 5, rev: 3, fields: { 'Microsoft.VSTS.TCM.Steps': OLD_STEPS } });
    });

    it('shows a result against the test case revision it recorded, not the latest', async () => {
      testApi.getTestResultById.mockResolvedValue(ranAtRevision());
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(witApi.getRevision).toHaveBeenCalledWith(5, 3, undefined, 'Engineering');
      expect(out.steps!.map((s) => s.stepId)).toEqual([2, 3]);
    });

    it('marks steps against that revision, so a step added later is not recognised', async () => {
      testApi.getTestResultById.mockResolvedValue(ranAtRevision());
      await expect(
        service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 4, outcome: 'Passed' }] })
      ).rejects.toThrow('Step 4 not found');
      await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: 3, outcome: 'Passed' }] });
      expect(testApi.updateTestResults).toHaveBeenCalledTimes(1);
    });

    it('resolves a step attachment against that revision', async () => {
      testApi.getTestResultById.mockResolvedValue(ranAtRevision());
      await service.addTestResultAttachment({ runId: 77, resultId: 100000, base64Content: 'aGk=', fileName: 'x.txt', stepId: 3 });
      expect(testApi.createTestIterationResultAttachment).toHaveBeenCalledWith(expect.anything(), 'Engineering', 77, 100000, 1, '00000003');
    });

    it('builds the bug repro steps from that revision', async () => {
      testApi.getTestResultById.mockResolvedValue(ranAtRevision({}, [{ actionPath: '00000003', outcome: 'Failed', errorMessage: 'broke' }]));
      await service.createBugFromTestRun({ runId: 77, resultId: 100000 });
      const repro = witApi.createWorkItem.mock.calls[0][1].find((p: any) => p.path === '/fields/Microsoft.VSTS.TCM.ReproSteps').value;
      expect(repro).toContain('Click save');
      expect(repro).not.toContain('Latest only');
    });

    it('uses the latest steps when the result recorded no revision', async () => {
      testApi.getTestResultById.mockResolvedValue(resultWithIteration());
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(witApi.getRevision).not.toHaveBeenCalled();
      expect(out.steps!.map((s) => s.stepId)).toEqual([2, 3, 4]);
    });

    it('falls back to the latest steps when the revision cannot be read', async () => {
      witApi.getRevision.mockRejectedValue(new Error('revision not found'));
      testApi.getTestResultById.mockResolvedValue(ranAtRevision());
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(out.steps!.map((s) => s.stepId)).toEqual([2, 3, 4]);
    });

    it('reads each shared step set at the revision recorded on its reference row', async () => {
      witApi.getRevision.mockImplementation(async (id: number, rev: number) =>
        id === 5
          ? { id: 5, rev: 3, fields: { 'Microsoft.VSTS.TCM.Steps': SHARED_STEPS_XML } }
          : { id: 49, rev, fields: { 'System.Title': 'Login (old)', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML } });
      witApi.getWorkItem.mockImplementation(async (id: number) =>
        id === 49
          ? { id: 49, rev: 9, fields: { 'System.Title': 'Login (new)', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML.replace('Sign in', 'Sign in with SSO') } }
          : { id: 5, rev: 5, fields: { 'Microsoft.VSTS.TCM.Steps': SHARED_STEPS_XML } });
      testApi.getTestResultById.mockResolvedValue(
        ranAtRevision({}, [{ actionPath: '00000002', outcome: 'Passed', sharedStepModel: { id: 49, revision: 2 } }])
      );
      const out = await service.getTestResult({ runId: 77, resultId: 100000 });
      expect(witApi.getRevision).toHaveBeenCalledWith(49, 2, undefined, 'Engineering');
      expect(out.steps![1].action).toBe('Shared steps: Login (old)');
      expect(out.steps!.find((s) => s.stepId === '2;2')!.action).toBe('Sign in');
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

    describe('recording only a step inside a shared set', () => {
      const writtenActionResults = () => testApi.updateTestResults.mock.calls[0][0][0].iterationDetails[0].actionResults as any[];

      it('pins the set\'s revision on its reference row, which gets no outcome of its own', async () => {
        testApi.getTestResultById.mockResolvedValue(resultWithIteration());
        await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: '2;2', outcome: 'Failed', comment: 'bad password' }] });

        const parent = writtenActionResults().find((a) => a.actionPath === '00000002');
        expect(parent).toEqual(expect.objectContaining({ stepIdentifier: '2', sharedStepModel: { id: 49, revision: 4 }, outcome: 'None' }));
        expect(writtenActionResults().find((a) => a.actionPath === '0000000200000002')).toEqual(
          expect.objectContaining({ outcome: 'Failed', errorMessage: 'bad password' })
        );
      });

      it('keeps the outcome a reference row already has and adds the revision to it', async () => {
        testApi.getTestResultById.mockResolvedValue(resultWithIteration([{ actionPath: '00000002', iterationId: 1, stepIdentifier: '2', outcome: 'Passed' }]));
        await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: '2;1', outcome: 'Passed' }] });
        expect(writtenActionResults().find((a) => a.actionPath === '00000002')).toEqual(
          expect.objectContaining({ outcome: 'Passed', sharedStepModel: { id: 49, revision: 4 } })
        );
      });

      it('does not move a revision that was already pinned', async () => {
        witApi.getWorkItem.mockImplementation(async (id: number) =>
          id === 49
            ? { id: 49, rev: 9, fields: { 'System.Title': 'Login', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML } }
            : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': SHARED_STEPS_XML, 'System.Title': 'Save works' } });
        witApi.getRevision = jest.fn().mockResolvedValue({ id: 49, rev: 2, fields: { 'System.Title': 'Login', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML } });
        testApi.getTestResultById.mockResolvedValue(
          resultWithIteration([{ actionPath: '00000002', iterationId: 1, stepIdentifier: '2', outcome: 'Passed', sharedStepModel: { id: 49, revision: 2 } }])
        );
        await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: '2;1', outcome: 'Passed' }] });
        expect(writtenActionResults().find((a) => a.actionPath === '00000002').sharedStepModel).toEqual({ id: 49, revision: 2 });
      });

      it('leaves the outcome tied to the instructions that were run when the set is edited afterwards', async () => {
        // a stand-in for the stored result: the write below is what a later read sees
        let stored: any = resultWithIteration();
        testApi.getTestResultById.mockImplementation(async () => JSON.parse(JSON.stringify(stored)));
        testApi.updateTestResults.mockImplementation(async (updates: any[]) => {
          stored = { ...stored, iterationDetails: updates[0].iterationDetails };
          return [stored];
        });

        // 1. only the child is recorded, while the shared set is at revision 4
        await service.setTestStepResults({ runId: 77, resultId: 100000, steps: [{ stepId: '2;2', outcome: 'Failed', comment: 'bad password' }] });

        // 2. the shared set is edited: revision 9 now says something else
        witApi.getWorkItem.mockImplementation(async (id: number) =>
          id === 49
            ? { id: 49, rev: 9, fields: { 'System.Title': 'Login (edited)', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML.replace('Sign in', 'Sign in with SSO') } }
            : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': SHARED_STEPS_XML, 'System.Title': 'Save works' } });
        witApi.getRevision = jest.fn().mockImplementation(async (id: number, rev: number) => {
          expect(id).toBe(49);
          expect(rev).toBe(4); // the revision pinned by step 1, not the latest
          return { id: 49, rev: 4, fields: { 'System.Title': 'Login', 'Microsoft.VSTS.TCM.Steps': SHARED_SET_XML } };
        });

        // 3. reading the result still shows the failure against the original instruction
        const out = await service.getTestResult({ runId: 77, resultId: 100000 });
        const failed = out.steps!.find((s) => s.stepId === '2;2')!;
        expect(failed.outcome).toBe('Failed');
        expect(failed.action).toBe('Sign in');
        expect(witApi.getRevision).toHaveBeenCalledWith(49, 4, undefined, 'Engineering');
      });
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
    it('asks for the work item details so associated bugs are reported', async () => {
      testApi.getTestResultById.mockResolvedValue({ ...resultWithIteration(), associatedBugs: [{ id: '23256' }] });
      const out = await service.getTestResult({ runId: 77, resultId: 100000, includeSteps: false });
      // Iterations (1) | WorkItems (2)
      expect(testApi.getTestResultById).toHaveBeenCalledWith('Engineering', 77, 100000, 3);
      expect(out.associatedBugs).toEqual([23256]);
    });

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

    it('applies the size limit to base64 content as well as files', async () => {
      // ~110 MB once decoded; only its length matters, so it is never decoded
      const tooBig = 'A'.repeat(140 * 1024 * 1024);
      await expect(
        service.addTestResultAttachment({ runId: 77, resultId: 100000, base64Content: tooBig, fileName: 'huge.bin' })
      ).rejects.toThrow('the limit is 100 MB');
      await expect(
        service.addTestRunAttachment({ runId: 77, base64Content: tooBig, fileName: 'huge.bin' })
      ).rejects.toThrow('the limit is 100 MB');
      expect(testApi.createTestResultAttachment).not.toHaveBeenCalled();
      expect(testApi.createTestRunAttachment).not.toHaveBeenCalled();
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

      it('does not look up the current resolution when the caller supplies the replacement id', async () => {
        // the result reports only a resolution name, and the resolution-state route is unavailable
        restGet.mockResolvedValue({ statusCode: 404, result: null });
        testApi.getTestResultById.mockResolvedValue({ id: 100000, resolutionState: 'Test issue' });
        await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, resolutionStateId: 11 });
        expect(restGet).not.toHaveBeenCalled();
        expect(testApi.updateTestResults.mock.calls[0][0][0].resolutionStateId).toBe(11);
      });

      it('still needs the lookup to keep a current resolution that is reported by name only', async () => {
        restGet.mockResolvedValue({ statusCode: 404, result: null });
        testApi.getTestResultById.mockResolvedValue({ id: 100000, resolutionState: 'Test issue' });
        await expect(service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'x' })).rejects.toThrow('pass resolutionStateId');
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

    describe('finding a tester by email or name', () => {
      let coreApi: Record<string, jest.Mock>;
      beforeEach(() => {
        coreApi = {
          getTeams: jest.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }]),
          getTeamMembersWithExtendedProperties: jest.fn().mockImplementation(async (_p: string, team: string) =>
            team === 't1'
              ? [{ identity: { id: 'guid-1', uniqueName: 'sam@selerix.com', displayName: 'Sam Other' } }]
              : [{ identity: { id: 'guid-9', uniqueName: 'Pat.Tester@selerix.com', displayName: 'Pat Tester' } }])
        };
        (service as any).connection.getCoreApi = jest.fn().mockResolvedValue(coreApi);
      });

      it('resolves an email to the identity GUID across the project teams', async () => {
        await service.assignTester({ planId: 1, testCaseIds: [5], tester: { uniqueName: 'pat.tester@selerix.com' } });
        expect(testApi.updateTestPoints).toHaveBeenCalledWith(
          { tester: { id: 'guid-9', uniqueName: 'Pat.Tester@selerix.com', displayName: 'Pat Tester' } }, 'Engineering', 1, 20, '9'
        );
      });

      it('resolves a display name too', async () => {
        await service.assignTester({ planId: 1, testCaseIds: [5], tester: { displayName: 'pat tester' } });
        expect(testApi.updateTestPoints.mock.calls[0][0].tester.id).toBe('guid-9');
      });

      const person = (n: number) => ({ identity: { id: `guid-x${n}`, uniqueName: `person${n}@selerix.com`, displayName: `Person ${n}` } });
      const pat = { identity: { id: 'guid-9', uniqueName: 'pat.tester@selerix.com', displayName: 'Pat Tester' } };

      it('finds a tester on a later page of teams', async () => {
        coreApi.getTeams.mockImplementation(async (_p: string, _m: boolean, _top: number, skip: number) =>
          skip === 0 ? Array.from({ length: 100 }, (_, i) => ({ id: `team-${i}` })) : [{ id: 'team-last' }]);
        coreApi.getTeamMembersWithExtendedProperties.mockImplementation(async (_p: string, team: string) =>
          team === 'team-last' ? [pat] : []);

        await service.assignTester({ planId: 1, testCaseIds: [5], tester: { uniqueName: 'pat.tester@selerix.com' } });

        expect(coreApi.getTeams.mock.calls.map((c) => [c[2], c[3]])).toEqual([[100, 0], [100, 100]]);
        expect(testApi.updateTestPoints.mock.calls[0][0].tester.id).toBe('guid-9');
      });

      it('finds a tester on a later page of a team\'s members', async () => {
        coreApi.getTeams.mockResolvedValue([{ id: 't1' }]);
        coreApi.getTeamMembersWithExtendedProperties.mockImplementation(async (_p: string, _t: string, _top: number, skip: number) =>
          skip === 0 ? Array.from({ length: 100 }, (_, i) => person(i)) : [pat]);

        await service.assignTester({ planId: 1, testCaseIds: [5], tester: { displayName: 'Pat Tester' } });

        expect(coreApi.getTeamMembersWithExtendedProperties.mock.calls.map((c) => [c[2], c[3]])).toEqual([[100, 0], [100, 100]]);
        expect(testApi.updateTestPoints.mock.calls[0][0].tester.id).toBe('guid-9');
      });

      it('finds an analysis owner the same way', async () => {
        coreApi.getTeams.mockResolvedValue([{ id: 't1' }]);
        coreApi.getTeamMembersWithExtendedProperties.mockImplementation(async (_p: string, _t: string, _top: number, skip: number) =>
          skip === 0 ? Array.from({ length: 100 }, (_, i) => person(i)) : [pat]);
        testApi.getTestResultById.mockResolvedValue({ id: 100000 });
        await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, analysisOwner: { uniqueName: 'pat.tester@selerix.com' } });
        expect(testApi.updateTestResults.mock.calls[0][0][0].owner.id).toBe('guid-9');
      });

      it('stops, and reports nobody found, when a server ignores skip and repeats the same page', async () => {
        coreApi.getTeams.mockResolvedValue(Array.from({ length: 100 }, () => ({ id: 'same-team' })));
        coreApi.getTeamMembersWithExtendedProperties.mockResolvedValue(Array.from({ length: 100 }, (_, i) => person(i)));
        await expect(
          service.assignTester({ planId: 1, testCaseIds: [5], tester: { uniqueName: 'nobody@selerix.com' } })
        ).rejects.toThrow("Could not find 'nobody@selerix.com'");
        // the first page has a new team so a second is requested; it repeats, which ends the search
        expect(coreApi.getTeams).toHaveBeenCalledTimes(2);
        expect(coreApi.getTeamMembersWithExtendedProperties).toHaveBeenCalledTimes(2);
      });

      it('does not search when a GUID is given', async () => {
        await service.assignTester({ planId: 1, testCaseIds: [5], tester: { id: 'guid-1' } });
        expect(coreApi.getTeams).not.toHaveBeenCalled();
      });

      it('fails clearly, without touching the points, when nobody matches', async () => {
        await expect(
          service.assignTester({ planId: 1, testCaseIds: [5], tester: { uniqueName: 'nobody@selerix.com' } })
        ).rejects.toThrow("Could not find 'nobody@selerix.com'");
        expect(testApi.updateTestPoints).not.toHaveBeenCalled();
      });
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
    describe('adding the run hyperlink when links to the same work item overlap', () => {
      const RUN77 = 'https://dev.azure.com/selerix/Engineering/_TestManagement/Runs?runId=77&_a=runCharts';
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let item: { rev: number; relations: { rel: string; url: string }[] };

      beforeEach(() => {
        item = { rev: 3, relations: [] };
        testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'run', webAccessUrl: RUN77 });
        witApi.getWorkItem.mockImplementation(async () => {
          await delay(5);
          return { id: 12, rev: item.rev, relations: item.relations.map((r) => ({ ...r })) };
        });
        // like Azure DevOps: a patch whose revision test no longer holds is rejected
        witApi.updateWorkItem.mockImplementation(async (_c: unknown, patch: any[]) => {
          await delay(5);
          if (patch.find((p) => p.op === 5 && p.path === '/rev')!.value !== item.rev) {
            throw Object.assign(new Error('TF26071: This work item has been changed by someone else since you opened it.'), { statusCode: 409 });
          }
          for (const p of patch.filter((q) => q.path === '/relations/-')) item.relations.push({ rel: p.value.rel, url: p.value.url });
          item.rev += 1;
          return { id: 12 };
        });
      });

      it('adds the hyperlink once when two results of one run are linked to the same work item at once', async () => {
        const [first, second] = await Promise.all([
          service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] }),
          service.linkTestRunToWorkItems({ runId: 77, resultId: 100001, workItemIds: [12] })
        ]);
        expect(item.relations.filter((r) => r.rel === 'Hyperlink')).toHaveLength(1);
        // one call added it, the other found it there after its first attempt was rejected
        expect([...first.hyperlinked, ...second.hyperlinked]).toEqual([12]);
      });

      it('adds it once however many calls overlap', async () => {
        await Promise.all([100000, 100001, 100002].map((resultId) =>
          service.linkTestRunToWorkItems({ runId: 77, resultId, workItemIds: [12] })));
        expect(item.relations.filter((r) => r.rel === 'Hyperlink')).toHaveLength(1);
      });

      it('guards the addition with the revision it read', async () => {
        await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });
        expect(witApi.updateWorkItem.mock.calls[0][1][0]).toEqual({ op: 5, path: '/rev', value: 3 });
      });

      it('gives up, naming the work item, when it keeps changing', async () => {
        witApi.updateWorkItem.mockRejectedValue(Object.assign(new Error('conflict'), { statusCode: 409 }));
        await expect(service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] })).rejects.toThrow(
          'Work item 12 kept changing while it was being updated (3 attempts), so nothing was added. Try again.'
        );
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(3);
      });

      it('does not retry an error that is not a conflict', async () => {
        witApi.updateWorkItem.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
        await expect(service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] })).rejects.toThrow('forbidden');
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(1);
      });
    });

    it('merges with bugs already associated and adds one run hyperlink', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, associatedBugs: [{ id: '11' }] });
      const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });

      expect(testApi.updateTestResults.mock.calls[0][0]).toEqual([{ id: 100000, associatedBugs: [{ id: '11' }, { id: '12' }] }]);
      const patch = witApi.updateWorkItem.mock.calls[0][1] as { op: number; path: string; value: any }[];
      expect(patch[0]).toEqual({ op: 5, path: '/rev', value: undefined }); // guarded by the revision it was read at
      expect(patch.find((p) => p.path === '/relations/-')!.value).toEqual(expect.objectContaining({ rel: 'Hyperlink', url: 'https://run/77' }));
      expect(out.hyperlinked).toEqual([12]);
    });

    it('treats a link to another view of the same run as the same hyperlink', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000 });
      witApi.getWorkItem.mockResolvedValue({
        relations: [{ rel: 'Hyperlink', url: 'https://dev.azure.com/selerix/Engineering/_testManagement/runs?runId=77&_a=resultSummary&resultId=100000' }]
      });
      testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'run', webAccessUrl: 'https://dev.azure.com/selerix/Engineering/_TestManagement/Runs?runId=77&_a=runCharts' });
      const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });
      expect(witApi.updateWorkItem).not.toHaveBeenCalled();
      expect(out.hyperlinked).toEqual([]);
    });

    describe('only the same run on the same site counts as an existing link', () => {
      const RUN77 = 'https://dev.azure.com/selerix/Engineering/_TestManagement/Runs?runId=77&_a=runCharts';
      const addsHyperlinkGiven = async (existingUrl: string) => {
        testApi.getTestResultById.mockResolvedValue({ id: 100000 });
        testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'run', webAccessUrl: RUN77 });
        witApi.getWorkItem.mockResolvedValue({ relations: [{ rel: 'Hyperlink', url: existingUrl }] });
        const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });
        return out.hyperlinked.length === 1;
      };

      it.each([
        ['another organization', 'https://dev.azure.com/otherorg/Engineering/_testManagement/runs?runId=77'],
        ['another project', 'https://dev.azure.com/selerix/OtherProject/_testManagement/runs?runId=77'],
        ['another host', 'https://selerix.visualstudio.com/Engineering/_testManagement/runs?runId=77'],
        ['an unrelated site', 'https://example.com/anything?runId=77'],
        ['another page of the same site', 'https://dev.azure.com/selerix/Engineering/_build/results?runId=77']
      ])('adds the hyperlink when the existing one is on %s', async (_label, existing) => {
        expect(await addsHyperlinkGiven(existing)).toBe(true);
      });

      it.each([
        ['another view of the run', 'https://dev.azure.com/selerix/Engineering/_testManagement/runs?runId=77&_a=resultSummary&resultId=1'],
        ['a different letter case and a trailing slash', 'https://DEV.azure.com/selerix/Engineering/_testmanagement/runs/?RUNID=77'],
        ['the same address', RUN77]
      ])('skips the hyperlink when the existing one is %s', async (_label, existing) => {
        expect(await addsHyperlinkGiven(existing)).toBe(false);
      });

      it('updateBugWithTestRun adds the current run\'s link when the bug has only another organization\'s run 77', async () => {
        testApi.getTestResultById.mockResolvedValue({ ...resultWithIteration(), id: 100000 });
        testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'run', webAccessUrl: RUN77 });
        witApi.getWorkItem.mockImplementation(async (id: number) =>
          id === 700
            ? { id: 700, fields: {}, relations: [{ rel: 'Hyperlink', url: 'https://dev.azure.com/otherorg/Engineering/_testManagement/runs?runId=77&_a=resultSummary&resultId=100000' }] }
            : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': STEPS_XML, 'System.Title': 'Save works' } });
        await service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 });
        const patch = witApi.updateWorkItem.mock.calls[0][1];
        const links = patch.filter((p: any) => p.path === '/relations/-' && p.value.rel === 'Hyperlink').map((p: any) => p.value.url);
        expect(links).toEqual([expect.stringContaining('https://dev.azure.com/selerix/Engineering/_testManagement/runs?runId=77')]);
      });
    });

    it('still adds a hyperlink for a different run', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000 });
      witApi.getWorkItem.mockResolvedValue({
        relations: [{ rel: 'Hyperlink', url: 'https://dev.azure.com/selerix/Engineering/_TestManagement/Runs?runId=770&_a=runCharts' }]
      });
      testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'run', webAccessUrl: 'https://dev.azure.com/selerix/Engineering/_TestManagement/Runs?runId=77&_a=runCharts' });
      const out = await service.linkTestRunToWorkItems({ runId: 77, resultId: 100000, workItemIds: [12] });
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
      expect(repro).toContain('<b>3.</b> Click save <b>[FAILED]</b>');
      expect(repro).toContain('Save button &lt;missing&gt;');
      expect(repro).toContain('shot.png');
      const rels = patch.filter((p: any) => p.path === '/relations/-').map((p: any) => p.value);
      expect(rels.map((r: any) => r.rel)).toEqual(['ArtifactLink', 'Hyperlink', 'Microsoft.VSTS.Common.TestedBy-Forward']);
      expect(rels[0].url).toBe('vstfs:///TestManagement/TcmResult/77.100000');
      // the new bug is also recorded on the result
      expect(testApi.updateTestResults.mock.calls[0][0]).toEqual([{ id: 100000, associatedBugs: [{ id: '900' }] }]);
      expect(out.bugId).toBe(900);
    });

    describe('when linking fails after the work item was changed', () => {
      // preserving a name-only resolution needs a route that can be unavailable; here the update itself fails
      beforeEach(() => {
        testApi.updateTestResults.mockRejectedValue(new Error('resolution-state route unavailable'));
      });

      it('creating a bug reports the new bug id and says not to create it again', async () => {
        await expect(service.createBugFromTestRun({ runId: 77, resultId: 100000 })).rejects.toThrow(
          /Bug 900 was created \(https:\/\/wi\/900\) but could not be linked to test result 77\/100000: resolution-state route unavailable\. Do not create the bug again; retry linkTestRunToWorkItems with runId 77, resultId 100000 and workItemIds \[900\]/
        );
        expect(witApi.createWorkItem).toHaveBeenCalledTimes(1);
      });

      it('updating a bug says it was updated and not to repeat the update', async () => {
        witApi.getWorkItem.mockImplementation(async (id: number) =>
          id === 700
            ? { id: 700, fields: {}, relations: [] }
            : { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': STEPS_XML, 'System.Title': 'Save works' } });
        await expect(service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 })).rejects.toThrow(
          /Bug 700 was updated with test result 77\/100000 but the result could not be linked to it: resolution-state route unavailable\. Do not call updateBugWithTestRun again/
        );
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(1);
      });
    });

    describe('updating a bug that changes while it is being updated', () => {
      const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      let bug: { rev: number; repro: string };

      beforeEach(() => {
        bug = { rev: 4, repro: '<p>original</p>' };
        witApi.getWorkItem.mockImplementation(async (id: number) => {
          if (id !== 700) {
            return { id: 5, url: 'https://wi/5', fields: { 'Microsoft.VSTS.TCM.Steps': STEPS_XML, 'System.Title': 'Save works' } };
          }
          await delay(5);
          return { id: 700, rev: bug.rev, fields: { 'Microsoft.VSTS.TCM.ReproSteps': bug.repro }, relations: [] };
        });
        // like Azure DevOps: a patch whose revision test no longer holds is rejected
        witApi.updateWorkItem.mockImplementation(async (_c: unknown, patch: any[], id: number) => {
          await delay(5);
          const test = patch.find((p) => p.op === 5 /* Test */ && p.path === '/rev');
          if (test && test.value !== bug.rev) {
            throw Object.assign(new Error('TF26071: This work item has been changed by someone else since you opened it.'), { statusCode: 409 });
          }
          const repro = patch.find((p) => p.path === '/fields/Microsoft.VSTS.TCM.ReproSteps');
          if (repro) bug.repro = repro.value;
          bug.rev += 1;
          return { id };
        });
      });

      it('sends the revision it read as a test, first in the patch', async () => {
        await service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 });
        const patch = witApi.updateWorkItem.mock.calls[0][1];
        expect(patch[0]).toEqual({ op: 5, path: '/rev', value: 4 });
      });

      it('keeps both reports when two updates append to the same bug at once', async () => {
        await Promise.all([
          service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000, appendToReproSteps: true, additionalDetails: 'FIRST REPORT' }),
          service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000, appendToReproSteps: true, additionalDetails: 'SECOND REPORT' })
        ]);
        expect(bug.repro).toContain('original');
        expect(bug.repro).toContain('FIRST REPORT');
        expect(bug.repro).toContain('SECOND REPORT');
        expect(bug.rev).toBe(6); // two successful updates, the stale attempt having been rejected
      });

      it('gives up after three conflicts and says nothing was added', async () => {
        witApi.updateWorkItem.mockRejectedValue(Object.assign(new Error('conflict'), { statusCode: 409 }));
        await expect(service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 })).rejects.toThrow(
          'Bug 700 kept changing while it was being updated (3 attempts), so nothing was added. Try again.'
        );
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(3);
        expect(testApi.updateTestResults).not.toHaveBeenCalled();
      });

      it('recognises a conflict from the message alone', async () => {
        witApi.updateWorkItem.mockRejectedValueOnce(new Error('TF26071: This work item has been changed by someone else since you opened it.'));
        await service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 });
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(2);
      });

      it('does not retry an error that is not a conflict', async () => {
        witApi.updateWorkItem.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
        await expect(service.updateBugWithTestRun({ bugId: 700, runId: 77, resultId: 100000 })).rejects.toThrow('forbidden');
        expect(witApi.updateWorkItem).toHaveBeenCalledTimes(1);
      });
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

  describe('points spread over several pages', () => {
    // Azure DevOps returns a page as an array carrying a continuationToken.
    const pageOf = (items: unknown[], continuationToken?: string) => Object.assign([...items], { continuationToken });

    it('acts on the points of every page, not just the first', async () => {
      testPlanApi.getPointsList
        .mockResolvedValueOnce(pageOf([{ id: 9, testCaseReference: { id: 5 } }], 'page2'))
        .mockResolvedValueOnce(pageOf([{ id: 10, testCaseReference: { id: 5 } }]));
      await service.resetTestToActive({ planId: 1, suiteId: 20, testCaseIds: [5] });

      expect(testPlanApi.getPointsList).toHaveBeenCalledTimes(2);
      expect(testPlanApi.getPointsList.mock.calls[1][5]).toBe('page2');
      expect(testApi.updateTestPoints).toHaveBeenCalledWith({ resetToActive: true }, 'Engineering', 1, 20, '9,10');
    });

    it('refuses to change anything when the points cannot all be read', async () => {
      testPlanApi.getPointsList.mockResolvedValue(pageOf([{ id: 9, testCaseReference: { id: 5 } }], 'more'));
      await expect(service.resetTestToActive({ planId: 1, suiteId: 20, testCaseIds: [5] })).rejects.toThrow('narrow the request');
      expect(testApi.updateTestPoints).not.toHaveBeenCalled();
      expect(testPlanApi.getPointsList).toHaveBeenCalledTimes(50);
    });

    it('getTestPoints reads every page before it filters and reports unresolved cases', async () => {
      testPlanApi.getPointsList
        .mockResolvedValueOnce(pageOf([{ id: 9, testCaseReference: { id: 6, name: 'Other' } }], 'page2'))
        .mockResolvedValueOnce(pageOf([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]));
      const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5] });
      expect(out.points.map((p) => p.pointId)).toEqual([10]);
      expect(out.unresolvedTestCaseIds).toEqual([]);
      expect(out.moreAvailable).toBeUndefined();
    });

    it('getTestPoints flags a suite too large to read in full', async () => {
      testPlanApi.getPointsList.mockResolvedValue(pageOf([{ id: 9, testCaseReference: { id: 5 } }], 'more'));
      const out = await service.getTestPoints({ planId: 1, suiteId: 20 });
      expect(out.moreAvailable).toBe(true);
    });
  });

  describe('getTestPoints', () => {
    const point = (over: Record<string, unknown> = {}) => ({
      id: 9,
      testCaseReference: { id: 5, name: 'Save works' },
      configuration: { id: 3, name: 'Windows 10' },
      isActive: false,
      isAutomated: false,
      tester: { displayName: 'Pat Tester' },
      results: { outcome: 3, state: 3, lastResultState: 5, lastTestRunId: 77, lastResultId: 100000, lastRunBuildNumber: '42', failureType: 1 },
      lastResetToActive: '2026-10-15T15:00:00Z',
      lastUpdatedBy: { displayName: 'Ivan' },
      lastUpdatedDate: '2026-10-15T15:01:00Z',
      ...over
    });

    it('reads the points of a test case from the plan\'s suite only', async () => {
      testPlanApi.getPointsList.mockResolvedValue([point()]);
      const out = await service.getTestPoints({ planId: 1, testCaseIds: [5] });

      expect(testPlanApi.getPointsList).toHaveBeenCalledTimes(1);
      expect(testPlanApi.getPointsList).toHaveBeenCalledWith('Engineering', 1, 20, undefined, '5', undefined, undefined, true, false);
      expect(out.points[0]).toEqual(expect.objectContaining({
        pointId: 9, suiteId: 20, testCaseId: 5, configuration: 'Windows 10', tester: 'Pat Tester',
        outcome: 'Failed', state: 'NotReady', lastResultState: 'Completed', failureType: 'Regression',
        lastRunId: 77, lastResultId: 100000, lastRunBuild: '42', lastResetToActive: '2026-10-15T15:00:00Z'
      }));
      expect(out.unresolvedTestCaseIds).toEqual([]);
    });

    it('reads every point of a suite when no test cases are given', async () => {
      testPlanApi.getPointsList.mockResolvedValue([point(), point({ id: 10, testCaseReference: { id: 6, name: 'Other' } })]);
      const out = await service.getTestPoints({ planId: 1, suiteId: 20 });
      expect(testPlanApi.getPointsList).toHaveBeenCalledWith('Engineering', 1, 20, undefined, undefined, undefined, undefined, true, false);
      expect(out.count).toBe(2);
      expect(testPlanApi.getSuitesByTestCaseId).not.toHaveBeenCalled();
    });

    it('reports requested test cases that have no point', async () => {
      testPlanApi.getPointsList.mockResolvedValue([point()]);
      const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5, 6] });
      expect(out.unresolvedTestCaseIds).toEqual([6]);
    });

    it('requires test cases or a suite', async () => {
      await expect(service.getTestPoints({ planId: 1 })).rejects.toThrow('testCaseIds, a suiteId, or both');
    });

    it('attaches recent results to each point when asked, newest first, capped per point', async () => {
      testPlanApi.getPointsList.mockResolvedValue([point()]);
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [
          { id: 3, testPoint: { id: '9' }, testRun: { id: '77' }, outcome: 'Failed', runBy: { displayName: 'Ivan' } },
          { id: 2, testPoint: { id: '9' }, testRun: { id: '70' }, outcome: 'Passed' },
          { id: 1, testPoint: { id: '9' }, testRun: { id: '60' }, outcome: 'Passed' },
          { id: 8, testPoint: { id: '99' }, testRun: { id: '50' }, outcome: 'Passed' }
        ]
      });
      const out = await service.getTestPoints({ planId: 1, testCaseIds: [5], includeHistory: true, historyTop: 2 });

      // by test case, not by point: a point-id query only returns each point's latest result
      expect(testApi.getTestResultsByQuery).toHaveBeenCalledTimes(1);
      const filter = testApi.getTestResultsByQuery.mock.calls[0][0].resultsFilter;
      expect(filter).toEqual(expect.objectContaining({ testCaseId: 5, testPlanId: 1 }));
      expect(filter.testPointIds).toBeUndefined();
      const history = out.points[0].history as { resultId: number; runName?: string }[];
      expect(history.map((h) => h.resultId)).toEqual([3, 2]);
      expect(history[0].runName).toBe('run');
    });

    describe('history of a point that another configuration crowds out', () => {
      // newest first; the query returns the latest `resultsCount` of them, like the real one
      const dataset = (newest: Record<string, unknown>[]) =>
        jest.fn().mockImplementation(async (q: { resultsFilter: { resultsCount: number } }) => ({
          results: newest.slice(0, q.resultsFilter.resultsCount)
        }));
      const resultsFor = (pointId: string, count: number, from: number) =>
        Array.from({ length: count }, (_, i) => ({
          id: from + i, outcome: 'Passed', testPoint: { id: pointId }, testRun: { id: String(from + i) }
        }));

      it('widens the query until the requested point has its history', async () => {
        // configuration A (point 9) ran 50 times more recently than configuration B (point 10) ever did
        testPlanApi.getPointsList.mockResolvedValue([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]);
        testApi.getTestResultsByQuery = dataset([...resultsFor('9', 50, 1000), ...resultsFor('10', 3, 500)]);

        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true });

        expect(testApi.getTestResultsByQuery.mock.calls.map((c) => c[0].resultsFilter.resultsCount)).toEqual([50, 100]);
        expect((out.points[0].history as unknown[]).length).toBe(3);
        // only the 3 returned entries are enriched, not the 50 results of the other configuration
        expect(testApi.getTestRunById.mock.calls.map((c) => c[1]).sort()).toEqual([500, 501, 502]);
        expect(out.historyIncompleteForPoints).toBeUndefined();
      });

      it('stops widening once the point has the history it asked for', async () => {
        testPlanApi.getPointsList.mockResolvedValue([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]);
        testApi.getTestResultsByQuery = dataset([...resultsFor('10', 40, 1000)]);
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true, historyTop: 5 });
        expect(testApi.getTestResultsByQuery).toHaveBeenCalledTimes(1);
        expect((out.points[0].history as unknown[]).length).toBe(5);
      });

      it('reports the point as incomplete when the cap is reached before it has enough results', async () => {
        testPlanApi.getPointsList.mockResolvedValue([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]);
        testApi.getTestResultsByQuery = dataset(resultsFor('9', 5000, 1000)); // only A, forever
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true });

        const counts = testApi.getTestResultsByQuery.mock.calls.map((c) => c[0].resultsFilter.resultsCount);
        expect(counts[counts.length - 1]).toBe(1000);
        expect(Math.max(...counts)).toBe(1000);
        expect(out.historyIncompleteForPoints).toEqual([10]);
        expect(out.points[0].history).toEqual([]);
        // nothing is returned for the point, so none of the 1000 unrelated runs is looked up
        expect(testApi.getTestRunById).not.toHaveBeenCalled();
        expect(testApi.getTestResults).not.toHaveBeenCalled();
      });

      it('caps each requested point before enriching, so lookups are bounded by points x historyTop', async () => {
        testPlanApi.getPointsList.mockResolvedValue([
          { id: 9, testCaseReference: { id: 5, name: 'Save works' } }, { id: 10, testCaseReference: { id: 5, name: 'Save works' } }
        ]);
        testApi.getTestResultsByQuery = dataset([...resultsFor('9', 20, 1000), ...resultsFor('10', 20, 2000)]);
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true, historyTop: 2 });

        expect(out.points.map((p) => (p.history as unknown[]).length)).toEqual([2, 2]);
        expect(testApi.getTestRunById).toHaveBeenCalledTimes(4);
      });

      it('reports unreadable runs only for entries that are returned', async () => {
        testPlanApi.getPointsList.mockResolvedValue([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]);
        // run 1001 belongs to the other configuration's results and is never looked up; run 500 is returned
        testApi.getTestResultsByQuery = dataset([...resultsFor('9', 50, 1000), ...resultsFor('10', 1, 500)]);
        testApi.getTestRunById.mockImplementation(async (_p: string, id: number) => {
          if (id === 500) throw new Error('unreadable');
          return { id, name: `run ${id}` };
        });
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true });
        expect(out.historyRunsNotLookedUp).toEqual([500]);
      });

      it('gives a point with no results an empty history rather than none', async () => {
        testPlanApi.getPointsList.mockResolvedValue([{ id: 10, testCaseReference: { id: 5, name: 'Save works' } }]);
        testApi.getTestResultsByQuery = dataset([]);
        const out = await service.getTestPoints({ planId: 1, suiteId: 20, testCaseIds: [5], includeHistory: true });
        expect(out.points[0].history).toEqual([]);
        expect(testApi.getTestResultsByQuery).toHaveBeenCalledTimes(1);
        expect(out.historyIncompleteForPoints).toBeUndefined();
      });
    });

    it('still returns the points when the history query fails', async () => {
      testPlanApi.getPointsList.mockResolvedValue([point()]);
      testApi.getTestResultsByQuery = jest.fn().mockRejectedValue(new Error('query not supported'));
      const out = await service.getTestPoints({ planId: 1, testCaseIds: [5], includeHistory: true });
      expect(out.count).toBe(1);
      expect(out.points[0].history).toBeUndefined();
      expect(out.historyError).toBe('query not supported');
    });
  });

  describe('run attachments', () => {
    let tmpDir: string;
    const attachments = [
      { id: 6, fileName: 'run-a-notes.txt', size: 28, comment: 'notes', createdDate: '2026-10-15T16:00:00Z', url: 'https://att/6' },
      { id: 7, fileName: 'big.bin', size: 200000, url: 'https://att/7' }
    ];
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-exec-att-'));
      testApi.getTestRunAttachments = jest.fn().mockResolvedValue(attachments);
      testApi.getTestRunAttachmentContent = jest.fn().mockImplementation(async (_p: string, _r: number, id: number) =>
        Readable.from([Buffer.from(id === 6 ? 'hello attachment' : 'x'.repeat(70 * 1024))]));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('lists the attachments of a run', async () => {
      const out = await service.listTestRunAttachments({ runId: 77 });
      expect(testApi.getTestRunAttachments).toHaveBeenCalledWith('Engineering', 77);
      expect(out.count).toBe(2);
      expect(out.attachments[0]).toEqual(expect.objectContaining({ id: 6, fileName: 'run-a-notes.txt', size: 28, comment: 'notes' }));
    });

    it('saves an attachment to the given file', async () => {
      const target = path.join(tmpDir, 'copy.txt');
      const out = await service.getTestRunAttachment({ runId: 77, attachmentId: 6, savePath: target });
      expect(fs.readFileSync(target, 'utf8')).toBe('hello attachment');
      expect(out).toEqual(expect.objectContaining({ fileName: 'run-a-notes.txt', savePath: target, size: 16 }));
    });

    it('saves into an existing folder under the attachment\'s own name', async () => {
      const out = await service.getTestRunAttachment({ runId: 77, attachmentId: 6, savePath: tmpDir });
      expect(out.savePath).toBe(path.join(tmpDir, 'run-a-notes.txt'));
      expect(fs.readFileSync(out.savePath!, 'utf8')).toBe('hello attachment');
    });

    it('returns a small attachment inline as base64', async () => {
      const out = await service.getTestRunAttachment({ runId: 77, attachmentId: 6 });
      expect(Buffer.from(out.base64Content!, 'base64').toString()).toBe('hello attachment');
    });

    it('refuses to return a large attachment inline and points at savePath', async () => {
      await expect(service.getTestRunAttachment({ runId: 77, attachmentId: 7 })).rejects.toThrow('savePath');
    });

    it('names the attachments that exist when the id is unknown', async () => {
      await expect(service.getTestRunAttachment({ runId: 77, attachmentId: 99 })).rejects.toThrow(
        'Test run 77 has no attachment 99. Attachments: 6 (run-a-notes.txt), 7 (big.bin)'
      );
    });

    describe('deleting', () => {
      // The Test API serves run attachments but rejects DELETE; the Test Results API accepts it.
      let del: jest.Mock;
      beforeEach(() => {
        del = jest.fn().mockResolvedValue(undefined);
        (service as any).getTestResultsApi = jest.fn().mockResolvedValue({ deleteTestRunAttachment: del });
      });

      it('deletes one attachment through the Test Results API', async () => {
        const out = await service.deleteTestRunAttachment({ runId: 77, attachmentId: 6 });
        expect(del).toHaveBeenCalledWith('Engineering', 77, 6);
        expect(out).toEqual({ runId: 77, attachmentId: 6, fileName: 'run-a-notes.txt', deleted: true });
      });

      it('does not send a delete for an attachment that does not exist', async () => {
        await expect(service.deleteTestRunAttachment({ runId: 77, attachmentId: 99 })).rejects.toThrow('no attachment 99');
        expect(del).not.toHaveBeenCalled();
      });

      it('passes on a failure from Azure DevOps', async () => {
        del.mockRejectedValue(new Error('Failed request: (403)'));
        await expect(service.deleteTestRunAttachment({ runId: 77, attachmentId: 6 })).rejects.toThrow('403');
      });
    });
  });

  describe('analysis owner', () => {
    beforeEach(() => {
      (service as any).connection.getCoreApi = jest.fn().mockResolvedValue({
        getTeams: jest.fn().mockResolvedValue([{ id: 't1' }]),
        getTeamMembersWithExtendedProperties: jest.fn().mockResolvedValue([
          { identity: { id: 'guid-9', uniqueName: 'pat.tester@selerix.com', displayName: 'Pat Tester' } }
        ])
      });
    });
    const sent = () => testApi.updateTestResults.mock.calls[0][0][0];

    it('sets the owner by GUID without a lookup', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, owner: { id: 'guid-9', displayName: 'Pat Tester' } });
      const out = await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, analysisOwner: { id: 'guid-9' } });
      expect(sent().owner).toEqual({ id: 'guid-9', uniqueName: undefined, displayName: undefined });
      expect(out.analysisOwner).toEqual(expect.objectContaining({ id: 'guid-9', displayName: 'Pat Tester' }));
    });

    it('resolves an email to the identity GUID', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000 });
      await service.updateTestResultAnalysis({ runId: 77, resultId: 100000, analysisOwner: { uniqueName: 'Pat.Tester@selerix.com' } });
      expect(sent().owner).toEqual({ id: 'guid-9', uniqueName: 'pat.tester@selerix.com', displayName: 'Pat Tester' });
    });

    it('fails without updating when the owner cannot be found', async () => {
      await expect(
        service.updateTestResultAnalysis({ runId: 77, resultId: 100000, analysisOwner: { uniqueName: 'nobody@selerix.com' } })
      ).rejects.toThrow("Could not find 'nobody@selerix.com'");
      expect(testApi.updateTestResults).not.toHaveBeenCalled();
    });

    it('keeps the current owner when something else on the result is updated', async () => {
      testApi.getTestResultById.mockResolvedValue({ id: 100000, comment: 'c', owner: { id: 'guid-o', displayName: 'Olive Owner' } });
      await service.addTestResultComment({ runId: 77, resultId: 100000, comment: 'more' });
      expect(sent().owner).toEqual({ id: 'guid-o' });
    });

    it('reports the owner when a result is read', async () => {
      testApi.getTestResultById.mockResolvedValue({ ...resultWithIteration(), owner: { id: 'guid-o', displayName: 'Olive Owner', uniqueName: 'olive@selerix.com' } });
      const out = await service.getTestResult({ runId: 77, resultId: 100000, includeSteps: false });
      expect(out.analysisOwner).toEqual({ id: 'guid-o', displayName: 'Olive Owner', uniqueName: 'olive@selerix.com' });
    });
  });

  describe('history', () => {
    it('fills in run names the query leaves blank', async () => {
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [{ id: 1, outcome: 'Passed', testPoint: { id: '9' }, testRun: { id: '77', name: '' } }]
      });
      testApi.getTestRunById.mockResolvedValue({ id: 77, name: 'Reports (Manual)' });
      const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });
      expect(out.executions[0]).toEqual(expect.objectContaining({ runName: 'Reports (Manual)', testPointId: 9 }));
    });

    it('reports the bugs associated with each result, which the results query leaves out', async () => {
      testApi.getTestResultsByQuery = jest.fn().mockResolvedValue({
        results: [{ id: 100000, outcome: 'Failed', testPoint: { id: '9' }, testRun: { id: '77' }, associatedBugs: [] }]
      });
      testApi.getTestResults.mockResolvedValue([{ id: 100000, associatedBugs: [{ id: '23256' }] }]);
      const out = await service.getTestCaseExecutionHistory({ testCaseId: 5 });
      expect(testApi.getTestResults).toHaveBeenCalledWith('Engineering', 77, 2, 0, 200);
      expect(out.executions[0].associatedBugs).toEqual([23256]);
    });

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
