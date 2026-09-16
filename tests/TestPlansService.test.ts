import { TestPlansService } from '../src/Services/TestPlansService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';
import { TestSuiteType, SuiteExpand } from 'azure-devops-node-api/interfaces/TestPlanInterfaces';

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

describe('TestPlansService', () => {
  let service: TestPlansService;
  let mockTestPlanApi: {
    createTestPlan: jest.Mock;
    getTestPlans: jest.Mock;
    getTestPlanById: jest.Mock;
    updateTestPlan: jest.Mock;
    deleteTestPlan: jest.Mock;
    createTestSuite: jest.Mock;
    getTestSuitesForPlan: jest.Mock;
    getTestSuiteById: jest.Mock;
    updateTestSuite: jest.Mock;
    deleteTestSuite: jest.Mock;
    addTestCasesToSuite: jest.Mock;
    getTestCaseList: jest.Mock;
    getSuitesByTestCaseId: jest.Mock;
    removeTestCasesFromSuite: jest.Mock;
    deleteTestCase: jest.Mock;
  };

  beforeEach(() => {
    service = new TestPlansService(testConfig);
    mockTestPlanApi = {
      createTestPlan: jest.fn(),
      getTestPlans: jest.fn(),
      getTestPlanById: jest.fn(),
      updateTestPlan: jest.fn(),
      deleteTestPlan: jest.fn(),
      createTestSuite: jest.fn(),
      getTestSuitesForPlan: jest.fn(),
      getTestSuiteById: jest.fn(),
      updateTestSuite: jest.fn(),
      deleteTestSuite: jest.fn(),
      addTestCasesToSuite: jest.fn(),
      getTestCaseList: jest.fn(),
      getSuitesByTestCaseId: jest.fn(),
      removeTestCasesFromSuite: jest.fn(),
      deleteTestCase: jest.fn()
    };
    (service as any).getTestPlanApi = jest.fn().mockResolvedValue(mockTestPlanApi);
  });

  describe('createTestPlan', () => {
    it('creates a plan with the given fields', async () => {
      const plan = { id: 1, name: 'Sprint 1 Plan' };
      mockTestPlanApi.createTestPlan.mockResolvedValue(plan);

      const result = await service.createTestPlan({ name: 'Sprint 1 Plan', iteration: 'Engineering\\Sprint 1' });

      expect(result).toBe(plan);
      expect(mockTestPlanApi.createTestPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sprint 1 Plan', iteration: 'Engineering\\Sprint 1' }),
        'Engineering'
      );
    });
  });

  describe('getTestPlanById', () => {
    it('propagates errors from the Azure DevOps API', async () => {
      mockTestPlanApi.getTestPlanById.mockRejectedValue(new Error('plan not found'));

      await expect(service.getTestPlanById({ planId: 999 })).rejects.toThrow('plan not found');
    });
  });

  describe('updateTestPlan', () => {
    it('sends the given name and iteration as-is', async () => {
      mockTestPlanApi.updateTestPlan.mockResolvedValue({ id: 17074 });

      await service.updateTestPlan({ planId: 17074, name: 'Renamed Plan', iteration: 'Engineering\\Sprint 2' });

      expect(mockTestPlanApi.getTestPlanById).not.toHaveBeenCalled();
      expect(mockTestPlanApi.updateTestPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed Plan', iteration: 'Engineering\\Sprint 2' }),
        'Engineering',
        17074
      );
    });

    it('backfills name and iteration from the existing plan when only updating another field', async () => {
      mockTestPlanApi.getTestPlanById.mockResolvedValue({ id: 17074, name: 'Sprint 1 Plan', iteration: 'Engineering\\Sprint 1' });
      mockTestPlanApi.updateTestPlan.mockResolvedValue({ id: 17074 });

      await service.updateTestPlan({ planId: 17074, state: 'Active' });

      expect(mockTestPlanApi.getTestPlanById).toHaveBeenCalledWith('Engineering', 17074);
      expect(mockTestPlanApi.updateTestPlan).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sprint 1 Plan', iteration: 'Engineering\\Sprint 1', state: 'Active' }),
        'Engineering',
        17074
      );
    });
  });

  describe('deleteTestPlan', () => {
    it('deletes the plan', async () => {
      mockTestPlanApi.deleteTestPlan.mockResolvedValue(undefined);

      await service.deleteTestPlan({ planId: 17074 });

      expect(mockTestPlanApi.deleteTestPlan).toHaveBeenCalledWith('Engineering', 17074);
    });
  });

  describe('createTestSuite', () => {
    it('defaults to a static suite and maps the parent suite reference', async () => {
      const suite = { id: 2, name: 'Enrollment Videos' };
      mockTestPlanApi.createTestSuite.mockResolvedValue(suite);

      const result = await service.createTestSuite({ planId: 17074, name: 'Enrollment Videos', parentSuiteId: 17074 });

      expect(result).toBe(suite);
      expect(mockTestPlanApi.createTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Enrollment Videos',
          suiteType: TestSuiteType.StaticTestSuite,
          parentSuite: { id: 17074, name: '' }
        }),
        'Engineering',
        17074
      );
    });

    it('maps dynamicTestSuite to the correct enum value', async () => {
      mockTestPlanApi.createTestSuite.mockResolvedValue({ id: 3 });

      await service.createTestSuite({
        planId: 17074,
        name: 'Query suite',
        parentSuiteId: 17074,
        suiteType: 'dynamicTestSuite',
        queryString: "SELECT * FROM WorkItems"
      });

      expect(mockTestPlanApi.createTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ suiteType: TestSuiteType.DynamicTestSuite, queryString: "SELECT * FROM WorkItems" }),
        'Engineering',
        17074
      );
    });

    it('rejects a requirementTestSuite without a requirementId', async () => {
      await expect(
        service.createTestSuite({
          planId: 17074,
          name: 'Requirement suite',
          parentSuiteId: 17074,
          suiteType: 'requirementTestSuite'
        })
      ).rejects.toThrow("requirementId is required when suiteType is 'requirementTestSuite'");

      expect(mockTestPlanApi.createTestSuite).not.toHaveBeenCalled();
    });

    it('passes requirementId through for a requirementTestSuite', async () => {
      mockTestPlanApi.createTestSuite.mockResolvedValue({ id: 4 });

      await service.createTestSuite({
        planId: 17074,
        name: 'Requirement suite',
        parentSuiteId: 17074,
        suiteType: 'requirementTestSuite',
        requirementId: 12345
      });

      expect(mockTestPlanApi.createTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ suiteType: TestSuiteType.RequirementTestSuite, requirementId: 12345 }),
        'Engineering',
        17074
      );
    });

    it('rejects a dynamicTestSuite without a queryString', async () => {
      await expect(
        service.createTestSuite({
          planId: 17074,
          name: 'Query suite',
          parentSuiteId: 17074,
          suiteType: 'dynamicTestSuite'
        })
      ).rejects.toThrow("queryString is required when suiteType is 'dynamicTestSuite'");

      expect(mockTestPlanApi.createTestSuite).not.toHaveBeenCalled();
    });
  });

  describe('getTestSuites', () => {
    it('lists suites for a plan with children expanded', async () => {
      const suites = [{ id: 17075, name: 'Enrollment Videos' }];
      mockTestPlanApi.getTestSuitesForPlan.mockResolvedValue(suites);

      const result = await service.getTestSuites({ planId: 17074 });

      expect(result).toBe(suites);
      expect(mockTestPlanApi.getTestSuitesForPlan).toHaveBeenCalledWith(
        'Engineering',
        17074,
        SuiteExpand.Children,
        undefined,
        undefined
      );
    });
  });

  describe('updateTestSuite', () => {
    it('sends the given name as-is', async () => {
      mockTestPlanApi.updateTestSuite.mockResolvedValue({ id: 17075 });

      await service.updateTestSuite({ planId: 17074, suiteId: 17075, name: 'Renamed Suite' });

      expect(mockTestPlanApi.getTestSuiteById).not.toHaveBeenCalled();
      expect(mockTestPlanApi.updateTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Renamed Suite' }),
        'Engineering',
        17074,
        17075
      );
    });

    it('backfills name from the existing suite when only updating the query string', async () => {
      mockTestPlanApi.getTestSuiteById.mockResolvedValue({ id: 17075, name: 'Enrollment Videos' });
      mockTestPlanApi.updateTestSuite.mockResolvedValue({ id: 17075 });

      await service.updateTestSuite({ planId: 17074, suiteId: 17075, queryString: "SELECT * FROM WorkItems" });

      expect(mockTestPlanApi.getTestSuiteById).toHaveBeenCalledWith('Engineering', 17074, 17075);
      expect(mockTestPlanApi.updateTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Enrollment Videos', queryString: "SELECT * FROM WorkItems" }),
        'Engineering',
        17074,
        17075
      );
    });
  });

  describe('getTestCasesFromSuite', () => {
    it('lists test cases contained in a suite', async () => {
      const testCases = [{ workItem: { id: 17077, name: 'Enrollment Videos: Saving a video...' } }];
      mockTestPlanApi.getTestCaseList.mockResolvedValue(testCases);

      const result = await service.getTestCasesFromSuite({ planId: 17074, suiteId: 17075 });

      expect(result).toBe(testCases);
      expect(mockTestPlanApi.getTestCaseList).toHaveBeenCalledWith(
        'Engineering',
        17074,
        17075,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('passes a continuation token through to fetch a subsequent page', async () => {
      mockTestPlanApi.getTestCaseList.mockResolvedValue([]);

      await service.getTestCasesFromSuite({ planId: 17074, suiteId: 17075, continuationToken: 'page-2-token' });

      expect(mockTestPlanApi.getTestCaseList).toHaveBeenCalledWith(
        'Engineering',
        17074,
        17075,
        undefined,
        undefined,
        undefined,
        'page-2-token',
        undefined,
        undefined,
        undefined,
        undefined
      );
    });

    it('passes isRecursive through to include child suites', async () => {
      mockTestPlanApi.getTestCaseList.mockResolvedValue([]);

      await service.getTestCasesFromSuite({ planId: 17074, suiteId: 17075, isRecursive: true });

      expect(mockTestPlanApi.getTestCaseList).toHaveBeenCalledWith(
        'Engineering',
        17074,
        17075,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true
      );
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockTestPlanApi.getTestCaseList.mockRejectedValue(new Error('suite not found'));

      await expect(service.getTestCasesFromSuite({ planId: 17074, suiteId: 404 })).rejects.toThrow('suite not found');
    });
  });

  describe('addTestCasesToSuite', () => {
    it('wraps each id as a work item reference', async () => {
      mockTestPlanApi.addTestCasesToSuite.mockResolvedValue([{ workItem: { id: 17077 } }]);

      await service.addTestCasesToSuite({ planId: 17074, suiteId: 17075, testCaseIds: [17077, 18275] });

      expect(mockTestPlanApi.addTestCasesToSuite).toHaveBeenCalledWith(
        [{ workItem: { id: 17077 } }, { workItem: { id: 18275 } }],
        'Engineering',
        17074,
        17075
      );
    });
  });

  describe('getSuitesForTestCase', () => {
    it('looks up suites without a project argument', async () => {
      const suites = [{ id: 17075, name: 'Enrollment Videos' }];
      mockTestPlanApi.getSuitesByTestCaseId.mockResolvedValue(suites);

      const result = await service.getSuitesForTestCase({ testCaseId: 17077 });

      expect(result).toBe(suites);
      expect(mockTestPlanApi.getSuitesByTestCaseId).toHaveBeenCalledWith(17077);
    });
  });

  describe('removeTestCasesFromSuite', () => {
    it('joins the test case ids into a comma-separated string', async () => {
      mockTestPlanApi.removeTestCasesFromSuite.mockResolvedValue(undefined);

      await service.removeTestCasesFromSuite({ planId: 17074, suiteId: 17075, testCaseIds: [17077, 18275] });

      expect(mockTestPlanApi.removeTestCasesFromSuite).toHaveBeenCalledWith('Engineering', 17074, 17075, '17077,18275');
    });
  });

  describe('deleteTestCase', () => {
    it('deletes the test case work item', async () => {
      mockTestPlanApi.deleteTestCase.mockResolvedValue(undefined);

      await service.deleteTestCase({ testCaseId: 17077 });

      expect(mockTestPlanApi.deleteTestCase).toHaveBeenCalledWith('Engineering', 17077);
    });
  });
});
