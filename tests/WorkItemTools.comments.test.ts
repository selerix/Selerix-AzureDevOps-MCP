import { WorkItemTools } from '../src/Tools/WorkItemTools';
import { WorkItemService } from '../src/Services/WorkItemService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';

jest.mock('../src/Services/WorkItemService');

const MockedWorkItemService = WorkItemService as jest.MockedClass<typeof WorkItemService>;

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

describe('WorkItemTools comment methods', () => {
  let tools: WorkItemTools;
  let serviceInstance: jest.Mocked<WorkItemService>;

  beforeEach(() => {
    MockedWorkItemService.mockClear();
    tools = new WorkItemTools(testConfig);
    serviceInstance = MockedWorkItemService.mock.instances[
      MockedWorkItemService.mock.instances.length - 1
    ] as jest.Mocked<WorkItemService>;
  });

  describe('getWorkItemComments', () => {
    it('formats a success response containing the comment count and list', async () => {
      const commentList = {
        comments: [
          { id: 1, text: 'first comment' },
          { id: 2, text: 'second comment' }
        ]
      };
      serviceInstance.getWorkItemComments.mockResolvedValue(commentList as any);

      const result = await tools.getWorkItemComments({ id: 42 });

      expect(serviceInstance.getWorkItemComments).toHaveBeenCalledWith({ id: 42 });
      expect(result.isError).toBeFalsy();
      expect(result.rawData).toEqual(commentList);
      expect(result.content[0].text).toContain('2');
      expect(result.content[0].text).toContain('42');
    });

    it('formats an empty response when the work item has no comments', async () => {
      serviceInstance.getWorkItemComments.mockResolvedValue({ comments: [] } as any);

      const result = await tools.getWorkItemComments({ id: 7 });

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('0');
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.getWorkItemComments.mockRejectedValue(new Error('work item not found'));

      const result = await tools.getWorkItemComments({ id: 404 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('work item not found');
    });
  });

  describe('updateWorkItemComment', () => {
    it('formats a success response containing the updated comment', async () => {
      const updatedComment = { id: 1, text: 'edited text' };
      serviceInstance.updateWorkItemComment.mockResolvedValue(updatedComment as any);

      const params = { id: 42, commentId: 1, text: 'edited text' };
      const result = await tools.updateWorkItemComment(params);

      expect(serviceInstance.updateWorkItemComment).toHaveBeenCalledWith(params);
      expect(result.isError).toBeFalsy();
      expect(result.rawData).toEqual(updatedComment);
      expect(result.content[0].text).toContain('1');
      expect(result.content[0].text).toContain('42');
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.updateWorkItemComment.mockRejectedValue(new Error('comment not found'));

      const result = await tools.updateWorkItemComment({ id: 42, commentId: 999, text: 'edited text' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('comment not found');
    });
  });

  describe('deleteWorkItemComment', () => {
    it('formats a success response after deleting the comment', async () => {
      serviceInstance.deleteWorkItemComment.mockResolvedValue(undefined);

      const result = await tools.deleteWorkItemComment({ id: 42, commentId: 1 });

      expect(serviceInstance.deleteWorkItemComment).toHaveBeenCalledWith({ id: 42, commentId: 1 });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('1');
      expect(result.content[0].text).toContain('42');
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.deleteWorkItemComment.mockRejectedValue(new Error('comment not found'));

      const result = await tools.deleteWorkItemComment({ id: 42, commentId: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('comment not found');
    });
  });
});
