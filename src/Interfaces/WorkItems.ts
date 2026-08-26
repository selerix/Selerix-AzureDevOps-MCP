/**
 * Interface for getting a work item by ID
 */
export interface WorkItemByIdParams {
  id: number;
}

/**
 * Interface for searching work items
 */
export interface SearchWorkItemsParams {
  searchText: string;
  top?: number;
}

/**
 * Interface for recently updated work items
 */
export interface RecentWorkItemsParams {
  top?: number;
  skip?: number;
}

/**
 * Interface for work items assigned to current user
 */
export interface MyWorkItemsParams {
  state?: string;
  top?: number;
}

/**
 * Interface for creating a work item
 */
export interface CreateWorkItemParams {
  workItemType: string;
  title: string;
  description?: string;
  assignedTo?: string;
  state?: string;
  areaPath?: string;
  iterationPath?: string;
  additionalFields?: Record<string, any>;
}

/**
 * Interface for updating a work item
 */
export interface UpdateWorkItemParams {
  id: number;
  fields: Record<string, any>;
}

/**
 * Interface for adding a comment to a work item
 */
export interface AddWorkItemCommentParams {
  id: number;
  text: string;
}

/**
 * Interface for updating a work item state
 */
export interface UpdateWorkItemStateParams {
  id: number;
  state: string;
  comment?: string;
}

/**
 * Interface for assigning a work item
 */
export interface AssignWorkItemParams {
  id: number;
  assignedTo: string;
}

/**
 * Interface for creating a link between work items
 */
export interface CreateLinkParams {
  sourceId: number;
  targetId: number;
  linkType: string;
  comment?: string;
}

/**
 * Interface for bulk operations on work items
 */
export interface BulkWorkItemParams {
  workItems: Array<CreateWorkItemParams | UpdateWorkItemParams>;
}

/**
 * Interface for uploading a file to Azure DevOps as an attachment.
 *
 * Provide exactly one content source:
 * - `filePath`: preferred whenever the file already exists on disk on the same machine as this
 *   MCP server. The server streams it directly — the bytes never have to pass through the
 *   caller's context, unlike `base64Content`, which the caller has to read and then re-generate
 *   verbatim as a tool argument (expensive in tokens, and can hit output-size limits on larger
 *   files).
 * - `base64Content`: only for content that doesn't exist as a file (e.g. generated in-memory).
 *   Requires `fileName` since there's no path to derive it from.
 */
export interface UploadAttachmentParams {
  fileName?: string;
  base64Content?: string;
  filePath?: string;
}

/**
 * Interface for uploading a file and linking it to a work item
 */
export interface AddWorkItemAttachmentParams extends UploadAttachmentParams {
  id: number;
  comment?: string;
}

/**
 * Interface for a single attachment linked to a work item
 */
export interface WorkItemAttachmentInfo {
  id?: string;
  url?: string;
  name?: string;
  comment?: string;
  resourceSize?: number;
} 