import { AzureDevOpsConfig } from '../Interfaces/AzureDevOps';
import { WorkItemService } from '../Services/WorkItemService';
import { formatMcpResponse, formatErrorResponse, McpResponse } from '../Interfaces/Common';
import {
  WorkItemByIdParams,
  SearchWorkItemsParams,
  RecentWorkItemsParams,
  MyWorkItemsParams,
  CreateWorkItemParams,
  UpdateWorkItemParams,
  AddWorkItemCommentParams,
  UpdateWorkItemStateParams,
  AssignWorkItemParams,
  CreateLinkParams,
  BulkWorkItemParams,
  UploadAttachmentParams,
  AddWorkItemAttachmentParams
} from '../Interfaces/WorkItems';
import getClassMethods from "../utils/getClassMethods";

export class WorkItemTools {
  private workItemService: WorkItemService;

  constructor(config: AzureDevOpsConfig) {
    this.workItemService = new WorkItemService(config);
  }

  /**
   * List work items based on a WIQL query
   */
  public async listWorkItems(params: { query: string }): Promise<McpResponse> {
    try {
      const response = await this.workItemService.listWorkItems(params.query);
      return formatMcpResponse(response, `Found ${response.workItems?.length || 0} work items.`);
    } catch (error) {
      console.error('Error in listWorkItems tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Get a work item by ID
   */
  public async getWorkItemById(params: WorkItemByIdParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.getWorkItemById(params);
      return formatMcpResponse(workItem, `Work item ${params.id} details`);
    } catch (error) {
      console.error('Error in getWorkItemById tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Search work items
   */
  public async searchWorkItems(params: SearchWorkItemsParams): Promise<McpResponse> {
    try {
      const results = await this.workItemService.searchWorkItems(params);
      return formatMcpResponse(results, `Found ${results.workItems?.length || 0} matching work items`);
    } catch (error) {
      console.error('Error in searchWorkItems tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Get recently updated work items
   */
  public async getRecentlyUpdatedWorkItems(params: RecentWorkItemsParams): Promise<McpResponse> {
    try {
      const results = await this.workItemService.getRecentWorkItems(params);
      return formatMcpResponse(results, `Found ${results.workItems?.length || 0} recently updated work items`);
    } catch (error) {
      console.error('Error in getRecentlyUpdatedWorkItems tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Get work items assigned to current user
   */
  public async getMyWorkItems(params: MyWorkItemsParams): Promise<McpResponse> {
    try {
      const results = await this.workItemService.getMyWorkItems(params);
      return formatMcpResponse(results, `Found ${results.workItems?.length || 0} work items assigned to you`);
    } catch (error) {
      console.error('Error in getMyWorkItems tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Create a work item
   */
  public async createWorkItem(params: CreateWorkItemParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.createWorkItem(params);
      return formatMcpResponse(workItem, `Created work item: ${workItem.id}`);
    } catch (error) {
      console.error('Error in createWorkItem tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Update a work item
   */
  public async updateWorkItem(params: UpdateWorkItemParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.updateWorkItem(params);
      return formatMcpResponse(workItem, `Updated work item: ${params.id}`);
    } catch (error) {
      console.error('Error in updateWorkItem tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Add a comment to a work item
   */
  public async addWorkItemComment(params: AddWorkItemCommentParams): Promise<McpResponse> {
    try {
      const comment = await this.workItemService.addWorkItemComment(params);
      return formatMcpResponse(comment, `Comment added to work item: ${params.id}`);
    } catch (error) {
      console.error('Error in addWorkItemComment tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Update work item state
   */
  public async updateWorkItemState(params: UpdateWorkItemStateParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.updateWorkItemState(params);
      return formatMcpResponse(workItem, `Updated state of work item ${params.id} to "${params.state}"`);
    } catch (error) {
      console.error('Error in updateWorkItemState tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Assign work item to a user
   */
  public async assignWorkItem(params: AssignWorkItemParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.assignWorkItem(params);
      return formatMcpResponse(workItem, `Assigned work item ${params.id} to ${params.assignedTo}`);
    } catch (error) {
      console.error('Error in assignWorkItem tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Create a link between work items
   */
  public async createLink(params: CreateLinkParams): Promise<McpResponse> {
    try {
      const workItem = await this.workItemService.createLink(params);
      return formatMcpResponse(workItem, `Created ${params.linkType} link from work item ${params.sourceId} to ${params.targetId}`);
    } catch (error) {
      console.error('Error in createLink tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * List attachments linked to a work item
   */
  public async listWorkItemAttachments(params: WorkItemByIdParams): Promise<McpResponse> {
    try {
      const attachments = await this.workItemService.listWorkItemAttachments(params);
      return formatMcpResponse(attachments, `Found ${attachments.length} attachment(s) on work item ${params.id}`);
    } catch (error) {
      console.error('Error in listWorkItemAttachments tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Bulk create or update work items
   */
  public async bulkCreateWorkItems(params: BulkWorkItemParams): Promise<McpResponse> {
    try {
      const results = await this.workItemService.bulkUpdateWorkItems(params);
      return formatMcpResponse(results, `Processed ${results.count} work items`);
    } catch (error) {
      console.error('Error in bulkCreateWorkItems tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Upload a file to Azure DevOps and get back its attachment URL, for embedding inline
   * (e.g. `<img src="...">`) in a work item's rich-text fields or comments.
   */
  public async uploadAttachment(params: UploadAttachmentParams): Promise<McpResponse> {
    try {
      const attachment = await this.workItemService.uploadAttachment(params);
      return formatMcpResponse(attachment, `Uploaded ${params.fileName || params.filePath}. Attachment URL: ${attachment.url}`);
    } catch (error) {
      console.error('Error in uploadAttachment tool:', error);
      return formatErrorResponse(error);
    }
  }

  /**
   * Upload a file and link it to a work item as a formal attachment.
   */
  public async addWorkItemAttachment(params: AddWorkItemAttachmentParams): Promise<McpResponse> {
    try {
      const result = await this.workItemService.addWorkItemAttachment(params);
      return formatMcpResponse(result, `Attached ${params.fileName || params.filePath} to work item ${params.id}. Attachment URL: ${result.attachment.url}`);
    } catch (error) {
      console.error('Error in addWorkItemAttachment tool:', error);
      return formatErrorResponse(error);
    }
  }
}

export const WorkItemToolMethods = getClassMethods(WorkItemTools.prototype);