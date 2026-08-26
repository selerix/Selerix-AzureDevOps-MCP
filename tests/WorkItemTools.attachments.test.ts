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

describe('WorkItemTools attachment methods', () => {
  let tools: WorkItemTools;
  let serviceInstance: jest.Mocked<WorkItemService>;

  beforeEach(() => {
    MockedWorkItemService.mockClear();
    tools = new WorkItemTools(testConfig);
    serviceInstance = MockedWorkItemService.mock.instances[
      MockedWorkItemService.mock.instances.length - 1
    ] as jest.Mocked<WorkItemService>;
  });

  describe('uploadAttachment', () => {
    it('formats a success response containing the attachment URL', async () => {
      serviceInstance.uploadAttachment.mockResolvedValue({
        id: 'abc-123',
        url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      });

      const params = { fileName: 'shot.png', base64Content: 'aGVsbG8=' };
      const result = await tools.uploadAttachment(params);

      expect(serviceInstance.uploadAttachment).toHaveBeenCalledWith(params);
      expect(result.isError).toBeFalsy();
      expect(result.rawData).toEqual({
        id: 'abc-123',
        url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      });
      expect(result.content[0].text).toContain('shot.png');
      expect(result.content[0].text).toContain(
        'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      );
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.uploadAttachment.mockRejectedValue(new Error('401 Unauthorized'));

      const result = await tools.uploadAttachment({ fileName: 'shot.png', base64Content: 'aGVsbG8=' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('401 Unauthorized');
    });

    it('passes filePath straight through and falls back to it in the message when fileName is omitted', async () => {
      serviceInstance.uploadAttachment.mockResolvedValue({
        id: 'abc-123',
        url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123'
      });

      const params = { filePath: 'C:\\Users\\me\\Downloads\\shot1.gif' };
      const result = await tools.uploadAttachment(params);

      expect(serviceInstance.uploadAttachment).toHaveBeenCalledWith(params);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('C:\\Users\\me\\Downloads\\shot1.gif');
    });
  });

  describe('listWorkItemAttachments', () => {
    it('formats a success response containing the attachment count and list', async () => {
      const attachments = [
        {
          id: 'abc-123',
          url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot1.png',
          name: 'shot1.png',
          comment: 'AC1 evidence'
        },
        {
          id: 'def-456',
          url: 'https://dev.azure.com/selerix/_apis/wit/attachments/def-456?fileName=shot2.png',
          name: 'shot2.png',
          comment: undefined
        }
      ];
      serviceInstance.listWorkItemAttachments.mockResolvedValue(attachments);

      const result = await tools.listWorkItemAttachments({ id: 42 });

      expect(serviceInstance.listWorkItemAttachments).toHaveBeenCalledWith({ id: 42 });
      expect(result.isError).toBeFalsy();
      expect(result.rawData).toEqual(attachments);
      expect(result.content[0].text).toContain('2');
      expect(result.content[0].text).toContain('42');
    });

    it('formats an empty response when the work item has no attachments', async () => {
      serviceInstance.listWorkItemAttachments.mockResolvedValue([]);

      const result = await tools.listWorkItemAttachments({ id: 7 });

      expect(result.isError).toBeFalsy();
      expect(result.rawData).toEqual([]);
      expect(result.content[0].text).toContain('0');
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.listWorkItemAttachments.mockRejectedValue(new Error('work item not found'));

      const result = await tools.listWorkItemAttachments({ id: 404 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('work item not found');
    });
  });

  describe('addWorkItemAttachment', () => {
    it('formats a success response containing the work item id and attachment URL', async () => {
      serviceInstance.addWorkItemAttachment.mockResolvedValue({
        attachment: {
          id: 'abc-123',
          url: 'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
        },
        workItem: { id: 42 }
      });

      const params = { id: 42, fileName: 'shot.png', base64Content: 'aGVsbG8=', comment: 'AC1 evidence' };
      const result = await tools.addWorkItemAttachment(params);

      expect(serviceInstance.addWorkItemAttachment).toHaveBeenCalledWith(params);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toContain('42');
      expect(result.content[0].text).toContain(
        'https://dev.azure.com/selerix/_apis/wit/attachments/abc-123?fileName=shot.png'
      );
    });

    it('formats an error response instead of throwing when the service call fails', async () => {
      serviceInstance.addWorkItemAttachment.mockRejectedValue(new Error('work item not found'));

      const result = await tools.addWorkItemAttachment({
        id: 999,
        fileName: 'shot.png',
        base64Content: 'aGVsbG8='
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('work item not found');
    });
  });
});
