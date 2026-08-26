import * as azdev from 'azure-devops-node-api';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { WorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import {
  JsonPatchOperation,
  Operation
} from 'azure-devops-node-api/interfaces/common/VSSInterfaces';
import {
  AttachmentReference,
  WorkItemExpand
} from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { AzureDevOpsConfig } from '../Interfaces/AzureDevOps';
import { AzureDevOpsService } from './AzureDevOpsService';
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
  AddWorkItemAttachmentParams,
  WorkItemAttachmentInfo
} from '../Interfaces/WorkItems';

// Above this decoded size, base64Content is rejected outright rather than accepted: inlining
// content that large requires the caller to generate it token-by-token as a tool argument,
// which can take many minutes (or exceed output-size limits) well before this service ever
// sees the call. filePath has no such ceiling since the server streams the file itself. Kept
// deliberately tiny (1 KB) so that essentially anything worth uploading - including small
// images - is forced through filePath rather than being inlined.
const MAX_BASE64_ATTACHMENT_BYTES = 1 * 1024; // 1 KB decoded

export class WorkItemService extends AzureDevOpsService {
  constructor(config: AzureDevOpsConfig) {
    super(config);
  }

  /**
   * Query work items using WIQL
   */
  public async listWorkItems(wiqlQuery: string): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      // Execute the WIQL query
      const queryResult = await witApi.queryByWiql({
        query: wiqlQuery
      }, {
        project: this.config.project
      });
      
      return queryResult;
    } catch (error) {
      console.error('Error listing work items:', error);
      throw error;
    }
  }

  /**
   * Get a work item by ID
   */
  public async getWorkItemById(params: WorkItemByIdParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const workItem = await witApi.getWorkItem(params.id, undefined, undefined, undefined, this.config.project);
      return workItem;
    } catch (error) {
      console.error(`Error getting work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Search work items using text
   */
  public async searchWorkItems(params: SearchWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const query = `SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate] 
                    FROM WorkItems 
                    WHERE [System.TeamProject] = @project 
                    AND (
                      [System.Title] CONTAINS '${params.searchText}'
                      OR [System.Description] CONTAINS '${params.searchText}'
                    )
                    ORDER BY [System.CreatedDate] DESC`;
      
      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });
      
      return queryResult;
    } catch (error) {
      console.error('Error searching work items:', error);
      throw error;
    }
  }

  /**
   * Get recently updated work items
   */
  public async getRecentWorkItems(params: RecentWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const query = `SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate] 
                    FROM WorkItems 
                    WHERE [System.TeamProject] = @project 
                    ORDER BY [System.ChangedDate] DESC`;
      
      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });
      
      const top = params.top || 10;
      const skip = params.skip || 0;
      
      if (queryResult.workItems) {
        queryResult.workItems = queryResult.workItems.slice(skip, skip + top);
      }
      
      return queryResult;
    } catch (error) {
      console.error('Error getting recent work items:', error);
      throw error;
    }
  }

  /**
   * Get work items assigned to current user
   */
  public async getMyWorkItems(params: MyWorkItemsParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      let stateCondition = '';
      if (params.state) {
        stateCondition = `AND [System.State] = '${params.state}'`;
      }
      
      const query = `SELECT [System.Id], [System.Title], [System.State], [System.CreatedDate] 
                    FROM WorkItems 
                    WHERE [System.TeamProject] = @project 
                    AND [System.AssignedTo] = @me
                    ${stateCondition}
                    ORDER BY [System.CreatedDate] DESC`;
      
      const queryResult = await witApi.queryByWiql({
        query
      }, {
        project: this.config.project
      });
      
      const top = params.top || 100;
      
      if (queryResult.workItems) {
        queryResult.workItems = queryResult.workItems.slice(0, top);
      }
      
      return queryResult;
    } catch (error) {
      console.error('Error getting my work items:', error);
      throw error;
    }
  }

  /**
   * Create a work item
   */
  public async createWorkItem(params: CreateWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [];
      
      // Add title
      patchDocument.push({
        op: Operation.Add,
        path: "/fields/System.Title",
        value: params.title
      });
      
      // Add description if provided
      if (params.description) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.Description",
          value: params.description
        });
      }
      
      // Add assigned to if provided
      if (params.assignedTo) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.AssignedTo",
          value: params.assignedTo
        });
      }
      
      // Add state if provided
      if (params.state) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.State",
          value: params.state
        });
      }
      
      // Add area path if provided
      if (params.areaPath) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.AreaPath",
          value: params.areaPath
        });
      }
      
      // Add iteration path if provided
      if (params.iterationPath) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.IterationPath",
          value: params.iterationPath
        });
      }
      
      // Add additional fields if provided
      if (params.additionalFields) {
        for (const [key, value] of Object.entries(params.additionalFields)) {
          patchDocument.push({
            op: Operation.Add,
            path: `/fields/${key}`,
            value: value
          });
        }
      }
      
      const workItem = await witApi.createWorkItem(
        undefined,
        patchDocument,
        this.config.project,
        params.workItemType
      );
      
      return workItem;
    } catch (error) {
      console.error('Error creating work item:', error);
      throw error;
    }
  }

  /**
   * Update a work item
   */
  public async updateWorkItem(params: UpdateWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [];
      
      // Add fields from the params
      for (const [key, value] of Object.entries(params.fields)) {
        patchDocument.push({
          op: Operation.Add,
          path: `/fields/${key}`,
          value: value
        });
      }
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error updating work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Add a comment to a work item
   */
  public async addWorkItemComment(params: AddWorkItemCommentParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const comment = await witApi.addComment({
        text: params.text
      }, this.config.project, params.id);
      
      return comment;
    } catch (error) {
      console.error(`Error adding comment to work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Update work item state
   */
  public async updateWorkItemState(params: UpdateWorkItemStateParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.State",
          value: params.state
        }
      ];
      
      // Add comment if provided
      if (params.comment) {
        patchDocument.push({
          op: Operation.Add,
          path: "/fields/System.History",
          value: params.comment
        });
      }
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error updating state for work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Assign work item to a user
   */
  public async assignWorkItem(params: AssignWorkItemParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/fields/System.AssignedTo",
          value: params.assignedTo
        }
      ];
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error assigning work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Create a link between work items
   */
  public async createLink(params: CreateLinkParams): Promise<any> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      
      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/relations/-",
          value: {
            rel: params.linkType,
            url: `${this.config.orgUrl}/_apis/wit/workItems/${params.targetId}`,
            attributes: {
              comment: params.comment || ""
            }
          }
        }
      ];
      
      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.sourceId,
        this.config.project
      );
      
      return workItem;
    } catch (error) {
      console.error(`Error creating link between work items:`, error);
      throw error;
    }
  }

  /**
   * Resolve an UploadAttachmentParams into an actual content stream + file name, enforcing that
   * exactly one content source (filePath or base64Content) was provided.
   */
  private resolveAttachmentContent(params: UploadAttachmentParams): {
    contentStream: NodeJS.ReadableStream;
    fileName: string;
  } {
    if (params.filePath && params.base64Content) {
      throw new Error('Provide either filePath or base64Content, not both.');
    }

    if (params.filePath) {
      // fs.createReadStream doesn't throw synchronously for a missing file - it emits an
      // async 'error' event instead, which (with nothing else consuming the stream yet)
      // surfaces as an unhandled error and crashes the process rather than rejecting this
      // call. Fail fast with a normal thrown error before a stream is ever created.
      if (!fs.existsSync(params.filePath)) {
        throw new Error(`File not found: ${params.filePath}`);
      }
      return {
        contentStream: fs.createReadStream(params.filePath),
        fileName: params.fileName || path.basename(params.filePath)
      };
    }

    if (params.base64Content) {
      if (!params.fileName) {
        throw new Error('fileName is required when uploading via base64Content.');
      }

      const paddingLength = params.base64Content.length - params.base64Content.replace(/=+$/, '').length;
      const approxDecodedBytes = Math.floor((params.base64Content.length * 3) / 4) - paddingLength;
      if (approxDecodedBytes > MAX_BASE64_ATTACHMENT_BYTES) {
        throw new Error(
          `base64Content is too large (~${Math.round(approxDecodedBytes / 1024)} KB decoded, ` +
          `limit is ${MAX_BASE64_ATTACHMENT_BYTES / 1024} KB). Use filePath instead - the file ` +
          `must already exist on disk for this to be worth uploading at all, and filePath ` +
          `streams it directly instead of requiring it to be generated as a tool argument.`
        );
      }

      return {
        contentStream: Readable.from([Buffer.from(params.base64Content, 'base64')]),
        fileName: params.fileName
      };
    }

    throw new Error('Either filePath or base64Content must be provided.');
  }

  /**
   * Upload a file to Azure DevOps as an attachment.
   *
   * Uses the same authenticated `azure-devops-node-api` connection as every other method on
   * this service (PAT / NTLM / Basic / Entra, on-premises or cloud) instead of a hand-rolled
   * HTTP call, so it works in exactly the situations where a standalone REST call with a raw
   * PAT does not (e.g. AZURE_DEVOPS_AUTH_TYPE=entra, where there is no static PAT to reuse).
   *
   * Prefer `filePath` over `base64Content` when the file is already on disk: the server streams
   * it directly, so the bytes never have to be read into and regenerated from the caller's
   * context (base64Content requires exactly that, which is both token-expensive and can hit
   * output-size limits on larger files).
   *
   * Returns an AttachmentReference `{ id, url }` — the `url` is what callers embed inline in a
   * rich-text field (e.g. `<img src="{url}">` in System.Description) via updateWorkItem/
   * addWorkItemComment, or link as a formal attachment via addWorkItemAttachment below.
   */
  public async uploadAttachment(params: UploadAttachmentParams): Promise<AttachmentReference> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const { contentStream, fileName } = this.resolveAttachmentContent(params);

      const attachment = await witApi.createAttachment(
        undefined,
        contentStream,
        fileName,
        undefined,
        this.config.project
      );

      return attachment;
    } catch (error) {
      console.error(`Error uploading attachment ${params.fileName || params.filePath}:`, error);
      throw error;
    }
  }

  /**
   * Upload a file and link it to a work item as a formal attachment (AttachedFile relation).
   */
  public async addWorkItemAttachment(params: AddWorkItemAttachmentParams): Promise<{ attachment: AttachmentReference; workItem: unknown }> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const attachment = await this.uploadAttachment(params);

      const patchDocument: JsonPatchOperation[] = [
        {
          op: Operation.Add,
          path: "/relations/-",
          value: {
            rel: "AttachedFile",
            url: attachment.url,
            attributes: {
              comment: params.comment || ""
            }
          }
        }
      ];

      const workItem = await witApi.updateWorkItem(
        undefined,
        patchDocument,
        params.id,
        this.config.project
      );

      return { attachment, workItem };
    } catch (error) {
      console.error(`Error attaching ${params.fileName || params.filePath} to work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * List attachments linked to a work item.
   *
   * Attachments aren't a separate ADO resource collection — they only surface as
   * `AttachedFile` relations on the work item itself, which requires fetching the work item
   * with relations expanded (not returned by default).
   */
  public async listWorkItemAttachments(params: WorkItemByIdParams): Promise<WorkItemAttachmentInfo[]> {
    try {
      const witApi = await this.getWorkItemTrackingApi();
      const workItem = await witApi.getWorkItem(
        params.id,
        undefined,
        undefined,
        WorkItemExpand.Relations,
        this.config.project
      );

      const relations = workItem.relations || [];

      return relations
        .filter(relation => relation.rel === 'AttachedFile')
        .map(relation => {
          const url = relation.url;
          const idMatch = url ? url.match(/\/attachments\/([^/?]+)/i) : null;

          return {
            id: idMatch ? idMatch[1] : undefined,
            url,
            name: relation.attributes?.name,
            comment: relation.attributes?.comment,
            resourceSize: relation.attributes?.resourceSize
          };
        });
    } catch (error) {
      console.error(`Error listing attachments for work item ${params.id}:`, error);
      throw error;
    }
  }

  /**
   * Bulk create or update work items
   */
  public async bulkUpdateWorkItems(params: BulkWorkItemParams): Promise<any> {
    try {
      const results = [];
      
      for (const workItemParams of params.workItems) {
        if ('id' in workItemParams) {
          // It's an update
          const result = await this.updateWorkItem(workItemParams);
          results.push(result);
        } else {
          // It's a create
          const result = await this.createWorkItem(workItemParams);
          results.push(result);
        }
      }
      
      return {
        count: results.length,
        workItems: results
      };
    } catch (error) {
      console.error('Error in bulk work item operation:', error);
      throw error;
    }
  }
} 