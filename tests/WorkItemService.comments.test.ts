import { WorkItemService } from '../src/Services/WorkItemService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';
import { CommentSortOrder } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

describe('WorkItemService comment methods', () => {
  let service: WorkItemService;
  let mockWitApi: { addComment: jest.Mock; getComments: jest.Mock; updateComment: jest.Mock; deleteComment: jest.Mock };

  beforeEach(() => {
    service = new WorkItemService(testConfig);
    mockWitApi = {
      addComment: jest.fn(),
      getComments: jest.fn(),
      updateComment: jest.fn(),
      deleteComment: jest.fn()
    };
    (service as any).getWorkItemTrackingApi = jest.fn().mockResolvedValue(mockWitApi);
  });

  describe('addWorkItemComment', () => {
    it('adds a comment and returns it', async () => {
      const comment = { id: 1, text: 'looks good' };
      mockWitApi.addComment.mockResolvedValue(comment);

      const result = await service.addWorkItemComment({ id: 42, text: 'looks good' });

      expect(result).toBe(comment);
      expect(mockWitApi.addComment).toHaveBeenCalledWith(
        { text: 'looks good' },
        'Engineering',
        42
      );
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockWitApi.addComment.mockRejectedValue(new Error('work item not found'));

      await expect(service.addWorkItemComment({ id: 404, text: 'hi' })).rejects.toThrow(
        'work item not found'
      );
    });
  });

  describe('getWorkItemComments', () => {
    it('fetches comments in ascending order by default', async () => {
      const commentList = { comments: [{ id: 1, text: 'first' }, { id: 2, text: 'second' }] };
      mockWitApi.getComments.mockResolvedValue(commentList);

      const result = await service.getWorkItemComments({ id: 42 });

      expect(result).toBe(commentList);
      expect(mockWitApi.getComments).toHaveBeenCalledWith(
        'Engineering',
        42,
        undefined,
        undefined,
        false,
        undefined,
        CommentSortOrder.Asc
      );
    });

    it('passes top through and sorts descending when requested', async () => {
      mockWitApi.getComments.mockResolvedValue({ comments: [] });

      await service.getWorkItemComments({ id: 42, top: 5, order: 'desc' });

      expect(mockWitApi.getComments).toHaveBeenCalledWith(
        'Engineering',
        42,
        5,
        undefined,
        false,
        undefined,
        CommentSortOrder.Desc
      );
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockWitApi.getComments.mockRejectedValue(new Error('work item not found'));

      await expect(service.getWorkItemComments({ id: 404 })).rejects.toThrow('work item not found');
    });
  });

  describe('updateWorkItemComment', () => {
    it('updates the comment text and returns the updated comment', async () => {
      const updatedComment = { id: 1, text: 'edited text' };
      mockWitApi.updateComment.mockResolvedValue(updatedComment);

      const result = await service.updateWorkItemComment({ id: 42, commentId: 1, text: 'edited text' });

      expect(result).toBe(updatedComment);
      expect(mockWitApi.updateComment).toHaveBeenCalledWith(
        { text: 'edited text' },
        'Engineering',
        42,
        1
      );
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockWitApi.updateComment.mockRejectedValue(new Error('comment not found'));

      await expect(
        service.updateWorkItemComment({ id: 42, commentId: 999, text: 'edited text' })
      ).rejects.toThrow('comment not found');
    });
  });

  describe('deleteWorkItemComment', () => {
    it('deletes the comment', async () => {
      mockWitApi.deleteComment.mockResolvedValue(undefined);

      await service.deleteWorkItemComment({ id: 42, commentId: 1 });

      expect(mockWitApi.deleteComment).toHaveBeenCalledWith('Engineering', 42, 1);
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockWitApi.deleteComment.mockRejectedValue(new Error('comment not found'));

      await expect(service.deleteWorkItemComment({ id: 42, commentId: 999 })).rejects.toThrow(
        'comment not found'
      );
    });
  });
});
