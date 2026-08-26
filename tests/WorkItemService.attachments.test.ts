import { WorkItemService } from '../src/Services/WorkItemService';
import { AzureDevOpsConfig } from '../src/Interfaces/AzureDevOps';
import { Operation } from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

const testConfig: AzureDevOpsConfig = {
  orgUrl: 'https://dev.azure.com/selerix',
  project: 'Engineering',
  personalAccessToken: 'fake-pat',
  isOnPremises: false,
  auth: { type: 'pat' }
};

describe('WorkItemService attachment methods', () => {
  let service: WorkItemService;
  let mockWitApi: { createAttachment: jest.Mock; updateWorkItem: jest.Mock; getWorkItem: jest.Mock };

  beforeEach(() => {
    service = new WorkItemService(testConfig);
    mockWitApi = {
      createAttachment: jest.fn(),
      updateWorkItem: jest.fn(),
      getWorkItem: jest.fn()
    };
    // Bypass the real Azure DevOps connection entirely; every other method on
    // AzureDevOpsService goes through this same seam, so mocking it here exercises
    // uploadAttachment/addWorkItemAttachment exactly the way the real call path does.
    (service as any).getWorkItemTrackingApi = jest.fn().mockResolvedValue(mockWitApi);
  });

  describe('uploadAttachment', () => {
    it('streams the decoded file content to createAttachment and returns the attachment reference', async () => {
      const originalBytes = Buffer.from('fake png bytes');
      const attachmentRef = {
        id: 'abc-123',
        url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      };
      mockWitApi.createAttachment.mockResolvedValue(attachmentRef);

      const result = await service.uploadAttachment({
        fileName: 'shot.png',
        base64Content: originalBytes.toString('base64')
      });

      expect(result).toBe(attachmentRef);
      expect(mockWitApi.createAttachment).toHaveBeenCalledTimes(1);

      const [customHeaders, contentStream, fileName, uploadType, project] =
        mockWitApi.createAttachment.mock.calls[0];

      expect(customHeaders).toBeUndefined();
      expect(fileName).toBe('shot.png');
      expect(uploadType).toBeUndefined();
      expect(project).toBe('Engineering');

      const streamedBytes = await streamToBuffer(contentStream);
      expect(streamedBytes.equals(originalBytes)).toBe(true);
    });

    it('propagates errors from the Azure DevOps API instead of swallowing them', async () => {
      mockWitApi.createAttachment.mockRejectedValue(new Error('network blip'));

      await expect(
        service.uploadAttachment({ fileName: 'shot.png', base64Content: 'aGVsbG8=' })
      ).rejects.toThrow('network blip');
    });
  });

  describe('addWorkItemAttachment', () => {
    it('uploads the file then links it to the work item as an AttachedFile relation', async () => {
      const attachmentRef = {
        id: 'abc-123',
        url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      };
      const updatedWorkItem = { id: 42, rev: 3 };
      mockWitApi.createAttachment.mockResolvedValue(attachmentRef);
      mockWitApi.updateWorkItem.mockResolvedValue(updatedWorkItem);

      const result = await service.addWorkItemAttachment({
        id: 42,
        fileName: 'shot.png',
        base64Content: Buffer.from('fake png bytes').toString('base64'),
        comment: 'AC1 evidence'
      });

      expect(result).toEqual({ attachment: attachmentRef, workItem: updatedWorkItem });

      expect(mockWitApi.updateWorkItem).toHaveBeenCalledTimes(1);
      const [customHeaders, patchDocument, workItemId, project] =
        mockWitApi.updateWorkItem.mock.calls[0];

      expect(customHeaders).toBeUndefined();
      expect(workItemId).toBe(42);
      expect(project).toBe('Engineering');
      expect(patchDocument).toEqual([
        {
          op: Operation.Add,
          path: '/relations/-',
          value: {
            rel: 'AttachedFile',
            url: attachmentRef.url,
            attributes: { comment: 'AC1 evidence' }
          }
        }
      ]);
    });

    it('defaults the relation comment to an empty string when none is provided', async () => {
      mockWitApi.createAttachment.mockResolvedValue({ id: 'x', url: 'https://example.test/x' });
      mockWitApi.updateWorkItem.mockResolvedValue({ id: 7 });

      await service.addWorkItemAttachment({
        id: 7,
        fileName: 'shot.png',
        base64Content: 'aGVsbG8='
      });

      const [, patchDocument] = mockWitApi.updateWorkItem.mock.calls[0];
      expect(patchDocument[0].value.attributes.comment).toBe('');
    });

    it('does not attempt to link the work item when the upload itself fails', async () => {
      mockWitApi.createAttachment.mockRejectedValue(new Error('upload failed'));

      await expect(
        service.addWorkItemAttachment({ id: 42, fileName: 'shot.png', base64Content: 'aGVsbG8=' })
      ).rejects.toThrow('upload failed');

      expect(mockWitApi.updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('listWorkItemAttachments', () => {
    it('fetches the work item with relations expanded and returns only AttachedFile relations', async () => {
      mockWitApi.getWorkItem.mockResolvedValue({
        id: 42,
        relations: [
          {
            rel: 'AttachedFile',
            url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot1.png',
            attributes: { name: 'shot1.png', comment: 'AC1 evidence', resourceSize: 2048 }
          },
          {
            // A regular work item link, not an attachment - must be filtered out.
            rel: 'System.LinkTypes.Hierarchy-Forward',
            url: 'https://dev.azure.com/selerix/_apis/wit/workItems/99'
          },
          {
            rel: 'AttachedFile',
            url: 'https://dev.azure.com/selerix/_apis/wit/attachments/def-456?fileName=shot2.png',
            attributes: { name: 'shot2.png' }
          }
        ]
      });

      const result = await service.listWorkItemAttachments({ id: 42 });

      expect(mockWitApi.getWorkItem).toHaveBeenCalledWith(
        42,
        undefined,
        undefined,
        WorkItemExpand.Relations,
        'Engineering'
      );

      expect(result).toEqual([
        {
          id: 'abc-123',
          url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot1.png',
          name: 'shot1.png',
          comment: 'AC1 evidence',
          resourceSize: 2048
        },
        {
          id: 'def-456',
          url: 'https://dev.azure.com/selerix/_apis/wit/attachments/def-456?fileName=shot2.png',
          name: 'shot2.png',
          comment: undefined,
          resourceSize: undefined
        }
      ]);
    });

    it('returns an empty array when the work item has no relations at all', async () => {
      mockWitApi.getWorkItem.mockResolvedValue({ id: 7 });

      const result = await service.listWorkItemAttachments({ id: 7 });

      expect(result).toEqual([]);
    });

    it('propagates errors from the Azure DevOps API', async () => {
      mockWitApi.getWorkItem.mockRejectedValue(new Error('work item not found'));

      await expect(service.listWorkItemAttachments({ id: 404 })).rejects.toThrow('work item not found');
    });
  });
});
