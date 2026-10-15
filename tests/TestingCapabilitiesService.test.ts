import { TestingCapabilitiesService } from '../src/Services/TestingCapabilitiesService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';
import { TestOutcome } from 'azure-devops-node-api/interfaces/TestInterfaces';

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

describe('TestingCapabilitiesService.getTestAutomationStatus', () => {
  let service: TestingCapabilitiesService;
  let testApi: { getTestRunById: jest.Mock; getTestResults: jest.Mock };

  beforeEach(() => {
    service = new TestingCapabilitiesService(testConfig);
    testApi = { getTestRunById: jest.fn(), getTestResults: jest.fn() };
    (service as any).connection.getTestApi = jest.fn().mockResolvedValue(testApi);
  });

  it('counts Failed results, not every completed result that did not pass', async () => {
    // 10 tests, all completed: 5 passed, 1 not applicable, 2 blocked, 1 inconclusive and 1 failed
    testApi.getTestRunById.mockResolvedValue({
      state: 'Completed', totalTests: 10, incompleteTests: 0, passedTests: 5, notApplicableTests: 1,
      runStatistics: [
        { state: 'Completed', outcome: 'Passed', count: 5 },
        { state: 'Completed', outcome: 'NotApplicable', count: 1 },
        { state: 'Completed', outcome: 'Blocked', count: 2 },
        { state: 'Completed', outcome: 'Inconclusive', count: 1 },
        { state: 'Completed', outcome: 'Failed', count: 1 }
      ]
    });
    const out = await service.getTestAutomationStatus({ testRunId: 77 });

    expect(out.failedTests).toBe(1);
    expect(out.passedTests).toBe(5);
    expect(out.completedTests).toBe(10);
    expect(out.outcomes).toEqual({ Passed: 5, NotApplicable: 1, Blocked: 2, Inconclusive: 1, Failed: 1 });
    expect(testApi.getTestRunById).toHaveBeenCalledWith('Engineering', 77, true);
  });

  it('reports no failures for a completed run whose only non-passes are Blocked', async () => {
    testApi.getTestRunById.mockResolvedValue({
      state: 'Completed', totalTests: 3, incompleteTests: 0, passedTests: 1,
      runStatistics: [{ state: 'Completed', outcome: 'Passed', count: 1 }, { state: 'Completed', outcome: 'Blocked', count: 2 }]
    });
    const out = await service.getTestAutomationStatus({ testRunId: 77 });
    expect(out.failedTests).toBe(0);
  });

  it('adds up Failed results across states', async () => {
    testApi.getTestRunById.mockResolvedValue({
      state: 'InProgress', totalTests: 5, incompleteTests: 2, passedTests: 1,
      runStatistics: [
        { state: 'Completed', outcome: 'Failed', count: 1 },
        { state: 'InProgress', outcome: 'Failed', count: 1 },
        { state: 'Completed', outcome: 'Passed', count: 1 }
      ]
    });
    const out = await service.getTestAutomationStatus({ testRunId: 77 });
    expect(out.failedTests).toBe(2);
    expect(out.completedTests).toBe(3);
  });

  it('counts Failed results page by page when the run has no statistics', async () => {
    testApi.getTestRunById.mockResolvedValue({ state: 'Completed', totalTests: 1200, incompleteTests: 0, passedTests: 0 });
    testApi.getTestResults
      .mockResolvedValueOnce(Array.from({ length: 1000 }, (_, i) => ({ id: i })))
      .mockResolvedValueOnce(Array.from({ length: 150 }, (_, i) => ({ id: 1000 + i })));
    const out = await service.getTestAutomationStatus({ testRunId: 77 });

    expect(out.failedTests).toBe(1150);
    expect(out.outcomes).toBeUndefined();
    expect(testApi.getTestResults).toHaveBeenNthCalledWith(1, 'Engineering', 77, undefined, 0, 1000, [TestOutcome.Failed]);
    expect(testApi.getTestResults).toHaveBeenNthCalledWith(2, 'Engineering', 77, undefined, 1000, 1000, [TestOutcome.Failed]);
  });

  it('reports zero failures for an empty run', async () => {
    testApi.getTestRunById.mockResolvedValue({ state: 'NotStarted' });
    testApi.getTestResults.mockResolvedValue([]);
    const out = await service.getTestAutomationStatus({ testRunId: 77 });
    expect(out).toEqual(expect.objectContaining({ status: 'NotStarted', totalTests: 0, failedTests: 0, completedTests: 0 }));
  });
});
