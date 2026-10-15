#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getAllowedTools, getAzureDevOpsConfig } from './config';
import { WorkItemTools } from './Tools/WorkItemTools';
import { BoardsSprintsTools } from './Tools/BoardsSprintsTools';
import { ProjectTools } from './Tools/ProjectTools';
import { GitTools } from './Tools/GitTools';
import { TestingCapabilitiesTools } from './Tools/TestingCapabilitiesTools';
import { TestPlansTools } from './Tools/TestPlansTools';
import { TestExecutionTools } from './Tools/TestExecutionTools';
import { DevSecOpsTools } from './Tools/DevSecOpsTools';
import { ArtifactManagementTools } from './Tools/ArtifactManagementTools';
import { AIAssistedDevelopmentTools } from './Tools/AIAssistedDevelopmentTools';
import { PipelinesTools } from './Tools/PipelinesTools';
import { z } from 'zod';
import { idSchema, limitSchema, prioritySchema, stepRefSchema } from './utils/toolSchemas';
import { EntraAuthHandler } from './Services/EntraAuthHandler';
import { HTML_FORMAT_FIELD_WARNING, HTML_FORMAT_FIELD_PARAM_NOTE } from './utils/richTextFields';

// Uses the string-instance-method form (not z.iso.*), which works under both Zod 3.25+
// and Zod 4 — @modelcontextprotocol/sdk permits either. The published bundle ships the
// zod version from package.json, so keep this form in case that range ever moves.
const isoDateString = z.union([z.string().date(), z.string().datetime({ offset: true })]);

async function main() {
  try {
    // Load configuration
    const azureDevOpsConfig = getAzureDevOpsConfig();
    if(azureDevOpsConfig.auth?.type === 'entra') {
      azureDevOpsConfig.entraAuthHandler = await EntraAuthHandler.getInstance();
    }
    // Load allowed tools
    const allowedTools = getAllowedTools();
    
    // Initialize tools
    const workItemTools = new WorkItemTools(azureDevOpsConfig);
    const boardsSprintsTools = new BoardsSprintsTools(azureDevOpsConfig);
    const projectTools = new ProjectTools(azureDevOpsConfig);
    const gitTools = new GitTools(azureDevOpsConfig);
    const testingCapabilitiesTools = new TestingCapabilitiesTools(azureDevOpsConfig);
    const testPlansTools = new TestPlansTools(azureDevOpsConfig);
    const testExecutionTools = new TestExecutionTools(azureDevOpsConfig);
    const devSecOpsTools = new DevSecOpsTools(azureDevOpsConfig);
    const artifactManagementTools = new ArtifactManagementTools(azureDevOpsConfig);
    const aiAssistedDevelopmentTools = new AIAssistedDevelopmentTools(azureDevOpsConfig);
    const pipelinesTools = new PipelinesTools(azureDevOpsConfig);

    // Create MCP server
    const server = new McpServer({
      name: 'azure-devops-mcp',
      version: '1.0.0',
      description: 'MCP server for Azure DevOps integration',
    });

    // Register Work Item Tools
    allowedTools.has("listWorkItems") && server.tool("listWorkItems", 
      "List work items based on a WIQL query",
      {
        query: z.string().describe("WIQL query to get work items")
      },
      async (params, extra) => {
        const result = await workItemTools.listWorkItems({ query: params.query });
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getWorkItemById") && server.tool("getWorkItemById", 
      "Get a specific work item by ID",
      {
        id: z.number().describe("Work item ID")
      },
      async (params, extra) => {
        const result = await workItemTools.getWorkItemById({ id: params.id });
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("searchWorkItems") && server.tool("searchWorkItems", 
      "Search for work items by text",
      {
        searchText: z.string().describe("Text to search for in work items"),
        top: z.number().optional().describe("Maximum number of work items to return")
      },
      async (params, extra) => {
        const result = await workItemTools.searchWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getRecentlyUpdatedWorkItems") && server.tool("getRecentlyUpdatedWorkItems", 
      "Get recently updated work items",
      {
        top: z.number().optional().describe("Maximum number of work items to return"),
        skip: z.number().optional().describe("Number of work items to skip")
      },
      async (params, extra) => {
        const result = await workItemTools.getRecentlyUpdatedWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getMyWorkItems") && server.tool("getMyWorkItems", 
      "Get work items assigned to you",
      {
        state: z.string().optional().describe("Filter by work item state"),
        top: z.number().optional().describe("Maximum number of work items to return")
      },
      async (params, extra) => {
        const result = await workItemTools.getMyWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createWorkItem") && server.tool("createWorkItem",
      `Create a new work item. ${HTML_FORMAT_FIELD_WARNING}`,
      {
        workItemType: z.string().describe("Type of work item to create"),
        title: z.string().describe("Title of the work item"),
        description: z.string().optional().describe(`Description of the work item. ${HTML_FORMAT_FIELD_PARAM_NOTE}`),
        assignedTo: z.string().optional().describe("User to assign the work item to"),
        state: z.string().optional().describe("Initial state of the work item"),
        areaPath: z.string().optional().describe("Area path for the work item"),
        iterationPath: z.string().optional().describe("Iteration path for the work item"),
        additionalFields: z.record(z.string(), z.any()).optional().describe(`Additional fields to set on the work item. If setting an HTML-format field (e.g. Microsoft.VSTS.TCM.Steps), see this tool's description for the &/</> gotcha.`)
      },
      async (params, extra) => {
        const result = await workItemTools.createWorkItem(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("updateWorkItem") && server.tool("updateWorkItem",
      `Update an existing work item. ${HTML_FORMAT_FIELD_WARNING}`,
      {
        id: z.number().describe("ID of the work item to update"),
        fields: z.record(z.string(), z.any()).describe(`Fields to update on the work item. If setting an HTML-format field (e.g. Microsoft.VSTS.TCM.Steps), see this tool's description for the &/</> gotcha.`)
      },
      async (params, extra) => {
        const result = await workItemTools.updateWorkItem(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("addWorkItemComment") && server.tool("addWorkItemComment", 
      "Add a comment to a work item",
      {
        id: z.number().describe("ID of the work item"),
        text: z.string().describe("Comment text")
      },
      async (params, extra) => {
        const result = await workItemTools.addWorkItemComment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getWorkItemComments") && server.tool("getWorkItemComments",
      "Read the comments (Discussion tab) on a work item",
      {
        id: z.number().describe("ID of the work item"),
        top: z.number().optional().describe("Maximum number of comments to return"),
        order: z.enum(["asc", "desc"]).optional().describe("Sort order for comments by creation date (default: asc)"),
        continuationToken: z.string().optional().describe("Continuation token from a previous call's response, used to fetch the next page of comments")
      },
      async (params, extra) => {
        const result = await workItemTools.getWorkItemComments(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateWorkItemComment") && server.tool("updateWorkItemComment",
      "Edit the text of an existing comment on a work item",
      {
        id: z.number().describe("ID of the work item"),
        commentId: z.number().describe("ID of the comment to update"),
        text: z.string().describe("New comment text")
      },
      async (params, extra) => {
        const result = await workItemTools.updateWorkItemComment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("deleteWorkItemComment") && server.tool("deleteWorkItemComment",
      "Delete a comment from a work item",
      {
        id: z.number().describe("ID of the work item"),
        commentId: z.number().describe("ID of the comment to delete")
      },
      async (params, extra) => {
        const result = await workItemTools.deleteWorkItemComment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateWorkItemState") && server.tool("updateWorkItemState",
      "Update the state of a work item",
      {
        id: z.number().describe("ID of the work item"),
        state: z.string().describe("New state for the work item"),
        comment: z.string().optional().describe("Comment explaining the state change")
      },
      async (params, extra) => {
        const result = await workItemTools.updateWorkItemState(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("assignWorkItem") && server.tool("assignWorkItem", 
      "Assign a work item to a user",
      {
        id: z.number().describe("ID of the work item"),
        assignedTo: z.string().describe("User to assign the work item to")
      },
      async (params, extra) => {
        const result = await workItemTools.assignWorkItem(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createLink") && server.tool("createLink", 
      "Create a link between work items",
      {
        sourceId: z.number().describe("ID of the source work item"),
        targetId: z.number().describe("ID of the target work item"),
        linkType: z.string().describe("Type of link to create"),
        comment: z.string().optional().describe("Comment explaining the link")
      },
      async (params, extra) => {
        const result = await workItemTools.createLink(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("bulkCreateWorkItems") && server.tool("bulkCreateWorkItems",
      `Create or update multiple work items in a single operation. ${HTML_FORMAT_FIELD_WARNING}`,
      {
        workItems: z.array(z.union([
          z.object({
            workItemType: z.string().describe("Type of work item to create"),
            title: z.string().describe("Title of the work item"),
            description: z.string().optional().describe(`Description of the work item. ${HTML_FORMAT_FIELD_PARAM_NOTE}`),
            assignedTo: z.string().optional().describe("User to assign the work item to"),
            state: z.string().optional().describe("Initial state of the work item"),
            areaPath: z.string().optional().describe("Area path for the work item"),
            iterationPath: z.string().optional().describe("Iteration path for the work item"),
            additionalFields: z.record(z.string(), z.any()).optional().describe(`Additional fields to set on the work item. If setting an HTML-format field (e.g. Microsoft.VSTS.TCM.Steps), see this tool's description for the &/</> gotcha.`)
          }),
          z.object({
            id: z.number().describe("ID of work item to update"),
            fields: z.record(z.string(), z.any()).describe(`Fields to update on the work item. If setting an HTML-format field (e.g. Microsoft.VSTS.TCM.Steps), see this tool's description for the &/</> gotcha.`)
          })
        ])).min(1).describe("Array of work items to create or update")
      },
      async (params, extra) => {
        const result = await workItemTools.bulkCreateWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("listWorkItemAttachments") && server.tool("listWorkItemAttachments",
      "List attachments linked to a work item (id, URL, file name, comment for each)",
      {
        id: z.number().describe("Work item ID")
      },
      async (params, extra) => {
        const result = await workItemTools.listWorkItemAttachments(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getWorkItemAttachment") && server.tool("getWorkItemAttachment",
      "Download the actual content of an attachment linked to a work item (e.g. to read a screenshot's contents), not just its metadata. Use listWorkItemAttachments first to get the attachment's id and file name.",
      {
        id: z.string().describe("Attachment ID (GUID), as returned by listWorkItemAttachments"),
        fileName: z.string().optional().describe("File name of the attachment, as returned by listWorkItemAttachments"),
        savePath: z.string().optional().describe("Absolute path to write the attachment content to on disk (same machine as this MCP server). Use this for anything beyond a trivial size: the server streams directly to disk instead of returning bytes inline. If omitted, content is returned inline as base64Content, but rejected above 1 KB decoded.")
      },
      async (params, extra) => {
        const result = await workItemTools.getWorkItemAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("uploadAttachment") && server.tool("uploadAttachment",
      "Upload a file (e.g. a screenshot) to Azure DevOps and get back its attachment URL, for embedding inline via an <img> tag in a work item's rich-text fields (Description, Repro Steps) or in a comment. Does not link the file to any work item by itself — pair with updateWorkItem/addWorkItemComment to place the returned URL, or use addWorkItemAttachment to also create a formal attachment link.",
      {
        filePath: z.string().optional().describe("Absolute path to the file on disk (same machine as this MCP server). Use this whenever the file already exists on disk, which includes every screenshot/recording/download case: the server streams it directly, so its bytes never pass through the caller's context. fileName defaults to this path's base name if omitted."),
        base64Content: z.string().optional().describe("Base64-encoded file content. Do NOT use this to upload a file that already exists on disk — call it with filePath instead. Only for content with no backing file (e.g. generated purely in-memory), and rejected outright above 1 KB decoded since inlining anything larger requires generating it token-by-token as this argument, which is extremely slow and token-expensive. Requires fileName."),
        fileName: z.string().optional().describe("File name including extension, e.g. screenshot.png. Required when using base64Content; optional (defaults to filePath's base name) when using filePath.")
      },
      async (params, extra) => {
        const result = await workItemTools.uploadAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("addWorkItemAttachment") && server.tool("addWorkItemAttachment",
      "Upload a file and attach it to a work item as a formal linked attachment. Also returns the attachment URL, which can additionally be embedded inline (e.g. <img src=\"...\">) in a rich-text field via updateWorkItem or addWorkItemComment.",
      {
        id: z.number().describe("ID of the work item to attach the file to"),
        filePath: z.string().optional().describe("Absolute path to the file on disk (same machine as this MCP server). Use this whenever the file already exists on disk, which includes every screenshot/recording/download case: the server streams it directly, so its bytes never pass through the caller's context. fileName defaults to this path's base name if omitted."),
        base64Content: z.string().optional().describe("Base64-encoded file content. Do NOT use this to upload a file that already exists on disk — call it with filePath instead. Only for content with no backing file (e.g. generated purely in-memory), and rejected outright above 1 KB decoded since inlining anything larger requires generating it token-by-token as this argument, which is extremely slow and token-expensive. Requires fileName."),
        fileName: z.string().optional().describe("File name including extension, e.g. screenshot.png. Required when using base64Content; optional (defaults to filePath's base name) when using filePath."),
        comment: z.string().optional().describe("Comment describing the attachment link")
      },
      async (params, extra) => {
        const result = await workItemTools.addWorkItemAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    // Register Boards & Sprints Tools
    allowedTools.has("getBoards") && server.tool("getBoards", 
      "Get all boards for a team",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getBoards(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getBoardColumns") && server.tool("getBoardColumns", 
      "Get columns for a specific board",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)"),
        boardId: z.string().describe("ID of the board")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getBoardColumns(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getBoardItems") && server.tool("getBoardItems", 
      "Get items on a specific board",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)"),
        boardId: z.string().describe("ID of the board")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getBoardItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("moveCardOnBoard") && server.tool("moveCardOnBoard", 
      "Move a card on a board",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)"),
        boardId: z.string().describe("ID of the board"),
        workItemId: z.number().describe("ID of the work item to move"),
        columnId: z.string().describe("ID of the column to move to"),
        position: z.number().optional().describe("Position within the column")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.moveCardOnBoard(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getSprints") && server.tool("getSprints", 
      "Get all sprints for a team",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getSprints(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getCurrentSprint") && server.tool("getCurrentSprint", 
      "Get the current sprint",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getCurrentSprint(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getSprintWorkItems") && server.tool("getSprintWorkItems", 
      "Get work items in a specific sprint",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)"),
        sprintId: z.string().describe("ID of the sprint")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getSprintWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getSprintCapacity") && server.tool("getSprintCapacity", 
      "Get capacity for a specific sprint",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)"),
        sprintId: z.string().describe("ID of the sprint")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getSprintCapacity(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getTeamMembers") && server.tool("getTeamMembers", 
      "Get members of a team",
      {
        teamId: z.string().optional().describe("Team ID (uses default team if not specified)")
      },
      async (params, extra) => {
        const result = await boardsSprintsTools.getTeamMembers(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    // Register Project Tools
    allowedTools.has("listProjects") && server.tool("listProjects", 
      "List all projects",
      {
        stateFilter: z.enum(['all', 'createPending', 'deleted', 'deleting', 'new', 'unchanged', 'wellFormed']).optional().describe("Filter by project state"),
        top: z.number().optional().describe("Maximum number of projects to return"),
        skip: z.number().optional().describe("Number of projects to skip")
      },
      async (params, extra) => {
        const result = await projectTools.listProjects(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getProjectDetails") && server.tool("getProjectDetails", 
      "Get details of a specific project",
      {
        projectId: z.string().describe("ID of the project"),
        includeCapabilities: z.boolean().optional().describe("Include project capabilities"),
        includeHistory: z.boolean().optional().describe("Include project history")
      },
      async (params, extra) => {
        const result = await projectTools.getProjectDetails(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createProject") && server.tool("createProject", 
      "Create a new project",
      {
        name: z.string().describe("Name of the project"),
        description: z.string().optional().describe("Description of the project"),
        visibility: z.enum(['private', 'public']).optional().describe("Visibility of the project"),
        capabilities: z.record(z.string(), z.any()).optional().describe("Project capabilities"),
        processTemplateId: z.string().optional().describe("Process template ID")
      },
      async (params, extra) => {
        const result = await projectTools.createProject(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getAreas") && server.tool("getAreas", 
      "Get areas for a project",
      {
        projectId: z.string().describe("ID of the project"),
        depth: z.number().optional().describe("Maximum depth of the area hierarchy")
      },
      async (params, extra) => {
        const result = await projectTools.getAreas(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getIterations") && server.tool("getIterations", 
      "Get iterations for a project",
      {
        projectId: z.string().describe("ID of the project"),
        includeDeleted: z.boolean().optional().describe("Include deleted iterations")
      },
      async (params, extra) => {
        const result = await projectTools.getIterations(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createArea") && server.tool("createArea", 
      "Create a new area in a project",
      {
        projectId: z.string().describe("ID of the project"),
        name: z.string().describe("Name of the area"),
        parentPath: z.string().optional().describe("Path of the parent area")
      },
      async (params, extra) => {
        const result = await projectTools.createArea(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createIteration") && server.tool("createIteration", 
      "Create a new iteration in a project",
      {
        projectId: z.string().describe("ID of the project"),
        name: z.string().describe("Name of the iteration"),
        parentPath: z.string().optional().describe("Path of the parent iteration"),
        startDate: z.string().optional().describe("Start date of the iteration"),
        finishDate: z.string().optional().describe("End date of the iteration")
      },
      async (params, extra) => {
        const result = await projectTools.createIteration(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getProcesses") && server.tool("getProcesses", 
      "Get all processes",
      {
        expandIcon: z.boolean().optional().describe("Include process icons")
      },
      async (params, extra) => {
        const result = await projectTools.getProcesses(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getWorkItemTypes") && server.tool("getWorkItemTypes", 
      "Get work item types for a process",
      {
        processId: z.string().describe("ID of the process")
      },
      async (params, extra) => {
        const result = await projectTools.getWorkItemTypes(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getWorkItemTypeFields") && server.tool("getWorkItemTypeFields", 
      "Get fields for a work item type",
      {
        processId: z.string().describe("ID of the process"),
        witRefName: z.string().describe("Reference name of the work item type")
      },
      async (params, extra) => {
        const result = await projectTools.getWorkItemTypeFields(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    // Register Git Tools
    allowedTools.has("listRepositories") && server.tool("listRepositories", 
      "List all repositories",
      {
        projectId: z.string().optional().describe("Filter by project"),
        includeHidden: z.boolean().optional().describe("Include hidden repositories"),
        includeAllUrls: z.boolean().optional().describe("Include all URLs")
      },
      async (params, extra) => {
        const result = await gitTools.listRepositories(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getRepository") && server.tool("getRepository", 
      "Get details of a specific repository",
      {
        projectId: z.string().describe("ID of the project"),
        repositoryId: z.string().describe("ID of the repository")
      },
      async (params, extra) => {
        const result = await gitTools.getRepository(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createRepository") && server.tool("createRepository", 
      "Create a new repository",
      {
        name: z.string().describe("Name of the repository"),
        projectId: z.string().describe("ID of the project")
      },
      async (params, extra) => {
        const result = await gitTools.createRepository(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("listBranches") && server.tool("listBranches", 
      "List branches in a repository",
      {
        repositoryId: z.string().describe("ID of the repository"),
        filter: z.string().optional().describe("Filter branches by name"),
        top: z.number().optional().describe("Maximum number of branches to return")
      },
      async (params, extra) => {
        const result = await gitTools.listBranches(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("searchCode") && server.tool("searchCode", 
      "Search for code in repositories",
      {
        searchText: z.string().describe("Text to search for"),
        projectId: z.string().optional().describe("ID of the project"),
        repositoryId: z.string().optional().describe("ID of the repository"),
        fileExtension: z.string().optional().describe("File extension to filter by"),
        top: z.number().optional().describe("Maximum number of results to return")
      },
      async (params, extra) => {
        const result = await gitTools.searchCode(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("browseRepository") && server.tool("browseRepository", 
      "Browse the contents of a repository",
      {
        repositoryId: z.string().describe("ID of the repository"),
        path: z.string().optional().describe("Path within the repository"),
        versionDescriptor: z.object({
          version: z.string().optional().describe("Version (branch, tag, or commit)"),
          versionOptions: z.string().optional().describe("Version options"),
          versionType: z.string().optional().describe("Version type")
        }).optional().describe("Version descriptor")
      },
      async (params, extra) => {
        const result = await gitTools.browseRepository(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getFileContent") && server.tool("getFileContent", 
      "Get the content of a file",
      {
        repositoryId: z.string().describe("ID of the repository"),
        path: z.string().describe("Path to the file"),
        versionDescriptor: z.object({
          version: z.string().optional().describe("Version (branch, tag, or commit)"),
          versionOptions: z.string().optional().describe("Version options"),
          versionType: z.string().optional().describe("Version type")
        }).optional().describe("Version descriptor")
      },
      async (params, extra) => {
        const result = await gitTools.getFileContent(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getCommitHistory") && server.tool("getCommitHistory", 
      "Get commit history for a repository",
      {
        repositoryId: z.string().describe("ID of the repository"),
        itemPath: z.string().optional().describe("Path to filter commits by"),
        top: z.number().optional().describe("Maximum number of commits to return"),
        skip: z.number().optional().describe("Number of commits to skip")
      },
      async (params, extra) => {
        const result = await gitTools.getCommitHistory(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("listPullRequests") && server.tool("listPullRequests", 
      "List pull requests",
      {
        repositoryId: z.string().describe("ID of the repository"),
        status: z.enum(['abandoned', 'active', 'all', 'completed', 'notSet']).optional().describe("Filter by status"),
        creatorId: z.string().optional().describe("Filter by creator"),
        reviewerId: z.string().optional().describe("Filter by reviewer"),
        top: z.number().optional().describe("Maximum number of pull requests to return"),
        skip: z.number().optional().describe("Number of pull requests to skip")
      },
      async (params, extra) => {
        const result = await gitTools.listPullRequests(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createPullRequest") && server.tool("createPullRequest", 
      "Create a new pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        sourceRefName: z.string().describe("Source branch"),
        targetRefName: z.string().describe("Target branch"),
        title: z.string().describe("Title of the pull request"),
        description: z.string().optional().describe("Description of the pull request"),
        reviewers: z.array(z.string()).optional().describe("List of reviewers")
      },
      async (params, extra) => {
        const result = await gitTools.createPullRequest(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getPullRequest") && server.tool("getPullRequest", 
      "Get details of a specific pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().describe("ID of the pull request")
      },
      async (params, extra) => {
        const result = await gitTools.getPullRequest(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getPullRequestChangedFiles") && server.tool("getPullRequestChangedFiles", 
      "Get changed files in a pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().describe("ID of the pull request"),
        iterationId: z.number().optional().describe("Specific pull request iteration ID (latest iteration is used by default)"),
        compareTo: z.number().optional().describe("Compare changes against a previous iteration ID"),
        top: z.number().optional().describe("Maximum number of changed files to return"),
        skip: z.number().optional().describe("Number of changed files to skip")
      },
      async (params, extra) => {
        const result = await gitTools.getPullRequestChangedFiles(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getPullRequestComments") && server.tool("getPullRequestComments", 
      "Get comments on a pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().describe("ID of the pull request"),
        threadId: z.number().optional().describe("ID of a specific thread"),
        top: z.number().optional().describe("Maximum number of comments to return"),
        skip: z.number().optional().describe("Number of comments to skip")
      },
      async (params, extra) => {
        const result = await gitTools.getPullRequestComments(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("approvePullRequest") && server.tool("approvePullRequest", 
      "Approve a pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().describe("ID of the pull request")
      },
      async (params, extra) => {
        const result = await gitTools.approvePullRequest(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("mergePullRequest") && server.tool("mergePullRequest", 
      "Merge a pull request",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().describe("ID of the pull request"),
        mergeStrategy: z.enum(['noFastForward', 'rebase', 'rebaseMerge', 'squash']).optional().describe("Merge strategy"),
        comment: z.string().optional().describe("Comment for the merge commit")
      },
      async (params, extra) => {
        const result = await gitTools.mergePullRequest(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    // Register Testing Capabilities Tools
    allowedTools.has("runAutomatedTests") && server.tool("runAutomatedTests", 
      "DEPRECATED placeholder: does not start a real run and returns a fixed run id. Use startTestRun instead.",
      {
        testSuiteId: z.number().optional().describe("ID of the test suite to run"),
        testPlanId: z.number().optional().describe("ID of the test plan to run"),
        testEnvironment: z.string().optional().describe("Environment to run tests in"),
        parallelExecution: z.boolean().optional().describe("Whether to run tests in parallel")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.runAutomatedTests(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getTestAutomationStatus") && server.tool("getTestAutomationStatus", 
      "Check the state and pass/fail counts of a test run (see also getTestRuns)",
      {
        testRunId: z.number().describe("ID of the test run to check status for")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.getTestAutomationStatus(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("configureTestAgents") && server.tool("configureTestAgents", 
      "Configure and manage test agents",
      {
        agentName: z.string().describe("Name of the test agent to configure"),
        capabilities: z.record(z.string(), z.any()).optional().describe("Capabilities to set for the agent"),
        enabled: z.boolean().optional().describe("Whether the agent should be enabled")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.configureTestAgents(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createTestDataGenerator") && server.tool("createTestDataGenerator", 
      "Generate test data for automated tests",
      {
        name: z.string().describe("Name of the test data generator"),
        dataSchema: z.record(z.string(), z.any()).describe("Schema for the test data to generate"),
        recordCount: z.number().optional().describe("Number of records to generate")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.createTestDataGenerator(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("manageTestEnvironments") && server.tool("manageTestEnvironments", 
      "Manage test environments for different test types",
      {
        environmentName: z.string().describe("Name of the test environment"),
        action: z.enum(['create', 'update', 'delete']).describe("Action to perform"),
        properties: z.record(z.string(), z.any()).optional().describe("Properties for the environment")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.manageTestEnvironments(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getTestFlakiness") && server.tool("getTestFlakiness", 
      "Analyze and report on test flakiness",
      {
        testId: z.number().optional().describe("ID of a specific test to analyze"),
        testRunIds: z.array(z.number()).optional().describe("Specific test runs to analyze"),
        timeRange: z.string().optional().describe("Time range for analysis (e.g., '30d')")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.getTestFlakiness(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getTestGapAnalysis") && server.tool("getTestGapAnalysis", 
      "Identify gaps in test coverage",
      {
        areaPath: z.string().optional().describe("Area path to analyze"),
        codeChangesOnly: z.boolean().optional().describe("Only analyze recent code changes")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.getTestGapAnalysis(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("runTestImpactAnalysis") && server.tool("runTestImpactAnalysis", 
      "Determine which tests to run based on code changes",
      {
        buildId: z.number().describe("ID of the build to analyze"),
        changedFiles: z.array(z.string()).optional().describe("List of changed files")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.runTestImpactAnalysis(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getTestHealthDashboard") && server.tool("getTestHealthDashboard", 
      "View overall test health metrics",
      {
        timeRange: z.string().optional().describe("Time range for metrics (e.g., '90d')"),
        includeTrends: z.boolean().optional().describe("Include trend data")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.getTestHealthDashboard(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("runTestOptimization") && server.tool("runTestOptimization", 
      "Optimize test suite execution for faster feedback",
      {
        testPlanId: z.number().describe("ID of the test plan to optimize"),
        optimizationGoal: z.enum(['time', 'coverage', 'reliability']).describe("Optimization goal")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.runTestOptimization(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createExploratorySessions") && server.tool("createExploratorySessions", 
      "Create new exploratory testing sessions",
      {
        title: z.string().describe("Title of the exploratory session"),
        description: z.string().optional().describe("Description of the session"),
        areaPath: z.string().optional().describe("Area path for the session")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.createExploratorySessions(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("recordExploratoryTestResults") && server.tool("recordExploratoryTestResults", 
      "Record findings during exploratory testing",
      {
        sessionId: z.number().describe("ID of the exploratory session"),
        findings: z.array(z.string()).describe("List of findings to record"),
        attachments: z.array(z.object({
          name: z.string().describe("Name of the attachment"),
          content: z.string().describe("Base64 encoded content of the attachment"),
          contentType: z.string().optional().describe("MIME type of the attachment")
        })).optional().describe("Attachments for the findings")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.recordExploratoryTestResults(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("convertFindingsToWorkItems") && server.tool("convertFindingsToWorkItems", 
      "Convert exploratory test findings to work items",
      {
        sessionId: z.number().describe("ID of the exploratory session"),
        findingIds: z.array(z.number()).describe("IDs of findings to convert"),
        workItemType: z.string().optional().describe("Type of work item to create")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.convertFindingsToWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getExploratoryTestStatistics") && server.tool("getExploratoryTestStatistics", 
      "Get statistics on exploratory testing activities",
      {
        timeRange: z.string().optional().describe("Time range for statistics (e.g., '90d')"),
        userId: z.string().optional().describe("Filter by specific user")
      },
      async (params, extra) => {
        const result = await testingCapabilitiesTools.getExploratoryTestStatistics(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    // Register Test Plans Tools
    allowedTools.has("createTestPlan") && server.tool("createTestPlan",
      "Create a new test plan",
      {
        name: z.string().describe("Name of the test plan"),
        iteration: z.string().describe("Iteration path of the test plan"),
        areaPath: z.string().optional().describe("Area path of the test plan"),
        description: z.string().optional().describe("Description of the test plan"),
        startDate: isoDateString.optional().describe("Start date of the test plan (ISO date string)"),
        endDate: isoDateString.optional().describe("End date of the test plan (ISO date string)"),
        state: z.string().optional().describe("State of the test plan")
      },
      async (params, extra) => {
        const result = await testPlansTools.createTestPlan(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestPlans") && server.tool("getTestPlans",
      "List test plans in the project",
      {
        owner: z.string().optional().describe("Filter by owner"),
        includePlanDetails: z.boolean().optional().describe("Include full plan details"),
        filterActivePlans: z.boolean().optional().describe("Only include active plans"),
        continuationToken: z.string().optional().describe("Continuation token for pagination")
      },
      async (params, extra) => {
        const result = await testPlansTools.getTestPlans(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestPlanById") && server.tool("getTestPlanById",
      "Get a test plan by ID",
      {
        planId: z.number().describe("ID of the test plan")
      },
      async (params, extra) => {
        const result = await testPlansTools.getTestPlanById(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateTestPlan") && server.tool("updateTestPlan",
      "Update an existing test plan",
      {
        planId: z.number().describe("ID of the test plan"),
        name: z.string().optional().describe("New name of the test plan"),
        iteration: z.string().optional().describe("New iteration path of the test plan"),
        areaPath: z.string().optional().describe("New area path of the test plan"),
        description: z.string().optional().describe("New description of the test plan"),
        startDate: isoDateString.optional().describe("New start date (ISO date string)"),
        endDate: isoDateString.optional().describe("New end date (ISO date string)"),
        state: z.string().optional().describe("New state of the test plan"),
        revision: z.number().optional().describe("Current revision of the test plan")
      },
      async (params, extra) => {
        const result = await testPlansTools.updateTestPlan(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("deleteTestPlan") && server.tool("deleteTestPlan",
      "Delete a test plan",
      {
        planId: z.number().describe("ID of the test plan to delete")
      },
      async (params, extra) => {
        const result = await testPlansTools.deleteTestPlan(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("createTestSuite") && server.tool("createTestSuite",
      "Create a new test suite under a test plan",
      {
        planId: z.number().describe("ID of the test plan"),
        name: z.string().describe("Name of the test suite"),
        parentSuiteId: z.number().describe("ID of the parent suite (e.g. the plan's root suite)"),
        suiteType: z.enum(['staticTestSuite', 'dynamicTestSuite', 'requirementTestSuite']).optional().describe("Type of the test suite (defaults to staticTestSuite)"),
        queryString: z.string().optional().describe("WIQL query string, required for dynamicTestSuite"),
        requirementId: z.number().optional().describe("ID of the requirement work item, required for requirementTestSuite")
      },
      async (params, extra) => {
        const result = await testPlansTools.createTestSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestSuites") && server.tool("getTestSuites",
      "List test suites in a test plan",
      {
        planId: z.number().describe("ID of the test plan"),
        asTreeView: z.boolean().optional().describe("Return suites structured as a tree"),
        continuationToken: z.string().optional().describe("Continuation token for pagination")
      },
      async (params, extra) => {
        const result = await testPlansTools.getTestSuites(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestSuiteById") && server.tool("getTestSuiteById",
      "Get a test suite by ID",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite"),
        includeChildren: z.boolean().optional().describe("Include child suites in the response")
      },
      async (params, extra) => {
        const result = await testPlansTools.getTestSuiteById(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateTestSuite") && server.tool("updateTestSuite",
      "Update an existing test suite",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite"),
        name: z.string().optional().describe("New name of the test suite"),
        queryString: z.string().optional().describe("New WIQL query string (dynamicTestSuite only)")
      },
      async (params, extra) => {
        const result = await testPlansTools.updateTestSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("deleteTestSuite") && server.tool("deleteTestSuite",
      "Delete a test suite",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite to delete")
      },
      async (params, extra) => {
        const result = await testPlansTools.deleteTestSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("addTestCasesToSuite") && server.tool("addTestCasesToSuite",
      "Add existing test cases to a test suite",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite"),
        testCaseIds: z.array(z.number()).min(1, "At least one test case ID is required").describe("IDs of the test cases to add")
      },
      async (params, extra) => {
        const result = await testPlansTools.addTestCasesToSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestCasesFromSuite") && server.tool("getTestCasesFromSuite",
      "List test cases contained in a test suite",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite"),
        isRecursive: z.boolean().optional().describe("Include test cases from child suites"),
        continuationToken: z.string().optional().describe("Continuation token for pagination")
      },
      async (params, extra) => {
        const result = await testPlansTools.getTestCasesFromSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getSuitesForTestCase") && server.tool("getSuitesForTestCase",
      "Find which test suites contain a given test case",
      {
        testCaseId: z.number().describe("ID of the test case")
      },
      async (params, extra) => {
        const result = await testPlansTools.getSuitesForTestCase(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("removeTestCasesFromSuite") && server.tool("removeTestCasesFromSuite",
      "Remove test cases from a test suite (does not delete the test case work items)",
      {
        planId: z.number().describe("ID of the test plan"),
        suiteId: z.number().describe("ID of the test suite"),
        testCaseIds: z.array(z.number()).min(1, "At least one test case ID is required").describe("IDs of the test cases to remove from the suite")
      },
      async (params, extra) => {
        const result = await testPlansTools.removeTestCasesFromSuite(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("deleteTestCase") && server.tool("deleteTestCase",
      "Permanently delete a test case work item",
      {
        testCaseId: z.number().describe("ID of the test case to delete")
      },
      async (params, extra) => {
        const result = await testPlansTools.deleteTestCase(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    // Register DevSecOps Tools
    allowedTools.has("runSecurityScan") && server.tool("runSecurityScan", 
      "Run security scans on repositories",
      {
        repositoryId: z.string().describe("ID of the repository to scan"),
        branch: z.string().optional().describe("Branch to scan"),
        scanType: z.enum(['static', 'dynamic', 'container', 'dependency', 'all']).optional().describe("Type of security scan to run")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.runSecurityScan(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getSecurityScanResults") && server.tool("getSecurityScanResults", 
      "Get results from security scans",
      {
        scanId: z.string().describe("ID of the scan to get results for"),
        severity: z.enum(['critical', 'high', 'medium', 'low', 'all']).optional().describe("Filter results by severity")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.getSecurityScanResults(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("trackSecurityVulnerabilities") && server.tool("trackSecurityVulnerabilities", 
      "Track and manage security vulnerabilities",
      {
        vulnerabilityId: z.string().optional().describe("ID of a specific vulnerability to track"),
        status: z.enum(['open', 'in-progress', 'mitigated', 'resolved', 'false-positive']).optional().describe("Filter by vulnerability status"),
        timeRange: z.string().optional().describe("Time range for tracking (e.g., '90d')")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.trackSecurityVulnerabilities(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("generateSecurityCompliance") && server.tool("generateSecurityCompliance", 
      "Generate security compliance reports",
      {
        standardType: z.enum(['owasp', 'pci-dss', 'hipaa', 'gdpr', 'iso27001', 'custom']).optional().describe("Compliance standard to report on"),
        includeEvidence: z.boolean().optional().describe("Include evidence in the report")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.generateSecurityCompliance(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("integrateSarifResults") && server.tool("integrateSarifResults", 
      "Import and process SARIF format security results",
      {
        sarifFilePath: z.string().describe("Path to the SARIF file to import"),
        createWorkItems: z.boolean().optional().describe("Create work items from findings")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.integrateSarifResults(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("runComplianceChecks") && server.tool("runComplianceChecks", 
      "Run compliance checks against standards",
      {
        complianceStandard: z.string().describe("Compliance standard to check against"),
        scopeId: z.string().optional().describe("Scope of the compliance check")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.runComplianceChecks(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getComplianceStatus") && server.tool("getComplianceStatus", 
      "Get current compliance status",
      {
        standardId: z.string().optional().describe("ID of the compliance standard"),
        includeHistory: z.boolean().optional().describe("Include historical compliance data")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.getComplianceStatus(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createComplianceReport") && server.tool("createComplianceReport", 
      "Create compliance reports for auditing",
      {
        standardId: z.string().describe("ID of the compliance standard"),
        format: z.enum(['pdf', 'html', 'json']).optional().describe("Format of the report")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.createComplianceReport(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("manageSecurityPolicies") && server.tool("manageSecurityPolicies", 
      "Manage security policies",
      {
        policyName: z.string().describe("Name of the security policy"),
        action: z.enum(['create', 'update', 'delete', 'get']).describe("Action to perform on the policy"),
        policyDefinition: z.record(z.string(), z.any()).optional().describe("Definition of the policy")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.manageSecurityPolicies(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("trackSecurityAwareness") && server.tool("trackSecurityAwareness", 
      "Track security awareness and training",
      {
        teamId: z.string().optional().describe("ID of the team to track"),
        trainingId: z.string().optional().describe("ID of specific training to track"),
        timeRange: z.string().optional().describe("Time range for tracking (e.g., '90d')")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.trackSecurityAwareness(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("rotateSecrets") && server.tool("rotateSecrets", 
      "Rotate secrets and credentials",
      {
        secretName: z.string().optional().describe("Name of the secret to rotate"),
        secretType: z.enum(['password', 'token', 'certificate', 'key']).optional().describe("Type of secret to rotate"),
        force: z.boolean().optional().describe("Force rotation even if not expired")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.rotateSecrets(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("auditSecretUsage") && server.tool("auditSecretUsage", 
      "Audit usage of secrets across services",
      {
        secretName: z.string().optional().describe("Name of the secret to audit"),
        timeRange: z.string().optional().describe("Time range for the audit (e.g., '30d')")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.auditSecretUsage(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("vaultIntegration") && server.tool("vaultIntegration", 
      "Integrate with secret vaults",
      {
        vaultUrl: z.string().describe("URL of the vault to integrate with"),
        secretPath: z.string().optional().describe("Path to the secret in the vault"),
        action: z.enum(['get', 'list', 'set', 'delete']).describe("Action to perform"),
        secretValue: z.string().optional().describe("Value to set (for 'set' action)")
      },
      async (params, extra) => {
        const result = await devSecOpsTools.vaultIntegration(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    // Register ArtifactManagement Tools
    allowedTools.has("listArtifactFeeds") && server.tool("listArtifactFeeds", 
      "List artifact feeds in the organization",
      {
        feedType: z.enum(['npm', 'nuget', 'maven', 'python', 'universal', 'all']).optional().describe("Type of feeds to list"),
        includeDeleted: z.boolean().optional().describe("Include deleted feeds")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.listArtifactFeeds(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getPackageVersions") && server.tool("getPackageVersions", 
      "Get versions of a package in a feed",
      {
        feedId: z.string().describe("ID of the feed"),
        packageName: z.string().describe("Name of the package"),
        top: z.number().optional().describe("Maximum number of versions to return")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.getPackageVersions(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("publishPackage") && server.tool("publishPackage", 
      "Publish a package to a feed",
      {
        feedId: z.string().describe("ID of the feed to publish to"),
        packageType: z.enum(['npm', 'nuget', 'maven', 'python', 'universal']).describe("Type of package"),
        packagePath: z.string().describe("Path to the package file"),
        packageVersion: z.string().optional().describe("Version of the package")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.publishPackage(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("promotePackage") && server.tool("promotePackage", 
      "Promote a package version between views",
      {
        feedId: z.string().describe("ID of the feed"),
        packageName: z.string().describe("Name of the package"),
        packageVersion: z.string().describe("Version of the package"),
        sourceView: z.string().describe("Source view (e.g., 'prerelease')"),
        targetView: z.string().describe("Target view (e.g., 'release')")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.promotePackage(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("deletePackageVersion") && server.tool("deletePackageVersion", 
      "Delete a version of a package",
      {
        feedId: z.string().describe("ID of the feed"),
        packageName: z.string().describe("Name of the package"),
        packageVersion: z.string().describe("Version of the package to delete"),
        permanent: z.boolean().optional().describe("Permanently delete the package version")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.deletePackageVersion(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("listContainerImages") && server.tool("listContainerImages", 
      "List container images in a repository",
      {
        repositoryName: z.string().optional().describe("Name of the container repository"),
        includeManifests: z.boolean().optional().describe("Include image manifests"),
        includeDeleted: z.boolean().optional().describe("Include deleted images")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.listContainerImages(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("getContainerImageTags") && server.tool("getContainerImageTags", 
      "Get tags for a container image",
      {
        repositoryName: z.string().describe("Name of the container repository"),
        imageName: z.string().describe("Name of the container image"),
        top: z.number().optional().describe("Maximum number of tags to return")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.getContainerImageTags(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("scanContainerImage") && server.tool("scanContainerImage", 
      "Scan a container image for vulnerabilities and compliance issues",
      {
        repositoryName: z.string().describe("Name of the container repository"),
        imageTag: z.string().describe("Tag of the container image to scan"),
        scanType: z.enum(['vulnerability', 'compliance', 'both']).optional().describe("Type of scan to perform")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.scanContainerImage(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("manageContainerPolicies") && server.tool("manageContainerPolicies", 
      "Manage policies for container repositories",
      {
        repositoryName: z.string().describe("Name of the container repository"),
        policyType: z.enum(['retention', 'security', 'access']).describe("Type of policy to manage"),
        action: z.enum(['get', 'set', 'delete']).describe("Action to perform on the policy"),
        policySettings: z.record(z.string(), z.any()).optional().describe("Settings for the policy when setting")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.manageContainerPolicies(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("manageUniversalPackages") && server.tool("manageUniversalPackages", 
      "Manage universal packages",
      {
        packageName: z.string().describe("Name of the universal package"),
        action: z.enum(['download', 'upload', 'delete']).describe("Action to perform"),
        packagePath: z.string().optional().describe("Path for package upload or download"),
        packageVersion: z.string().optional().describe("Version of the package")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.manageUniversalPackages(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("createPackageDownloadReport") && server.tool("createPackageDownloadReport", 
      "Create reports on package downloads",
      {
        feedId: z.string().optional().describe("ID of the feed"),
        packageName: z.string().optional().describe("Name of the package"),
        timeRange: z.string().optional().describe("Time range for the report (e.g., '30d')"),
        format: z.enum(['csv', 'json']).optional().describe("Format of the report")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.createPackageDownloadReport(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    allowedTools.has("checkPackageDependencies") && server.tool("checkPackageDependencies", 
      "Check package dependencies and vulnerabilities",
      {
        packageName: z.string().describe("Name of the package to check"),
        packageVersion: z.string().optional().describe("Version of the package"),
        includeTransitive: z.boolean().optional().describe("Include transitive dependencies"),
        checkVulnerabilities: z.boolean().optional().describe("Check for known vulnerabilities")
      },
      async (params, extra) => {
        const result = await artifactManagementTools.checkPackageDependencies(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );
    
    // AI Assisted Development Tools
    allowedTools.has("getAICodeReview") && server.tool("getAICodeReview", 
      "Get AI-based code review suggestions",
      {
        pullRequestId: z.number().optional().describe("ID of the pull request to review"),
        repositoryId: z.string().optional().describe("ID of the repository"),
        commitId: z.string().optional().describe("ID of the commit to review"),
        filePath: z.string().optional().describe("Path to the file to review")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.getAICodeReview(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("suggestCodeOptimization") && server.tool("suggestCodeOptimization", 
      "Suggest code optimizations using AI",
      {
        repositoryId: z.string().describe("ID of the repository"),
        filePath: z.string().describe("Path to the file to optimize"),
        lineStart: z.number().optional().describe("Starting line number"),
        lineEnd: z.number().optional().describe("Ending line number"),
        optimizationType: z.enum(['performance', 'memory', 'readability', 'all']).optional().describe("Type of optimization to focus on")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.suggestCodeOptimization(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("identifyCodeSmells") && server.tool("identifyCodeSmells", 
      "Identify potential code smells and anti-patterns",
      {
        repositoryId: z.string().describe("ID of the repository"),
        branch: z.string().optional().describe("Branch to analyze"),
        filePath: z.string().optional().describe("Path to the file to analyze"),
        severity: z.enum(['high', 'medium', 'low', 'all']).optional().describe("Severity level to filter by")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.identifyCodeSmells(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("getPredictiveBugAnalysis") && server.tool("getPredictiveBugAnalysis", 
      "Predict potential bugs in code changes",
      {
        repositoryId: z.string().describe("ID of the repository"),
        pullRequestId: z.number().optional().describe("ID of the pull request"),
        branch: z.string().optional().describe("Branch to analyze"),
        filePath: z.string().optional().describe("Path to the file to analyze")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.getPredictiveBugAnalysis(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("getDeveloperProductivity") && server.tool("getDeveloperProductivity", 
      "Measure developer productivity metrics",
      {
        userId: z.string().optional().describe("ID of the user"),
        teamId: z.string().optional().describe("ID of the team"),
        timeRange: z.string().optional().describe("Time range for analysis (e.g., '30d', '3m')"),
        includeMetrics: z.array(z.string()).optional().describe("Specific metrics to include")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.getDeveloperProductivity(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("getPredictiveEffortEstimation") && server.tool("getPredictiveEffortEstimation", 
      "AI-based effort estimation for work items",
      {
        workItemIds: z.array(z.number()).optional().describe("IDs of work items to estimate"),
        workItemType: z.string().optional().describe("Type of work items to estimate"),
        areaPath: z.string().optional().describe("Area path to filter work items")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.getPredictiveEffortEstimation(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("getCodeQualityTrends") && server.tool("getCodeQualityTrends", 
      "Track code quality trends over time",
      {
        repositoryId: z.string().optional().describe("ID of the repository"),
        branch: z.string().optional().describe("Branch to analyze"),
        timeRange: z.string().optional().describe("Time range for analysis (e.g., '90d', '6m')"),
        metrics: z.array(z.string()).optional().describe("Specific metrics to include")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.getCodeQualityTrends(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("suggestWorkItemRefinements") && server.tool("suggestWorkItemRefinements", 
      "Get AI suggestions for work item refinements",
      {
        workItemId: z.number().optional().describe("ID of the work item to refine"),
        workItemType: z.string().optional().describe("Type of work item"),
        areaPath: z.string().optional().describe("Area path to filter work items")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.suggestWorkItemRefinements(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("suggestAutomationOpportunities") && server.tool("suggestAutomationOpportunities", 
      "Identify opportunities for automation",
      {
        projectId: z.string().optional().describe("ID of the project"),
        scopeType: z.enum(['builds', 'releases', 'tests', 'workitems', 'all']).optional().describe("Type of scope to analyze")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.suggestAutomationOpportunities(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("createIntelligentAlerts") && server.tool("createIntelligentAlerts", 
      "Set up intelligent alerts based on patterns",
      {
        alertName: z.string().describe("Name of the alert"),
        alertType: z.enum(['build', 'release', 'test', 'workitem', 'code']).describe("Type of alert to create"),
        conditions: z.record(z.string(), z.any()).describe("Conditions for the alert"),
        actions: z.record(z.string(), z.any()).optional().describe("Actions to take when the alert triggers")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.createIntelligentAlerts(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("predictBuildFailures") && server.tool("predictBuildFailures", 
      "Predict potential build failures before they occur",
      {
        buildDefinitionId: z.number().describe("ID of the build definition"),
        lookbackPeriod: z.string().optional().describe("Period to analyze for patterns (e.g., '30d')")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.predictBuildFailures(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    allowedTools.has("optimizeTestSelection") && server.tool("optimizeTestSelection", 
      "Intelligently select tests to run based on changes",
      {
        buildId: z.number().describe("ID of the build"),
        changedFiles: z.array(z.string()).optional().describe("List of changed files"),
        maxTestCount: z.number().optional().describe("Maximum number of tests to select")
      },
      async (params, extra) => {
        const result = await aiAssistedDevelopmentTools.optimizeTestSelection(params);
        return {
          content: result.content,
          rawData: result.rawData,
        };
      }
    );

    // Register Pipelines Tools
    allowedTools.has("listPipelines") && server.tool("listPipelines",
      "List build pipelines (definitions) in the project, optionally filtered by name or folder path",
      {
        nameFilter: z.string().optional().describe("Filter to pipelines whose names match this pattern"),
        path: z.string().optional().describe("Filter to pipelines under this folder path"),
        top: z.number().optional().describe("Maximum number of pipelines to return")
      },
      async (params, extra) => {
        const result = await pipelinesTools.listPipelines(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getPipelineDetails") && server.tool("getPipelineDetails",
      "Get full details of a pipeline, including its variables, repository, and triggers",
      {
        pipelineId: z.number().describe("ID of the pipeline (build definition)")
      },
      async (params, extra) => {
        const result = await pipelinesTools.getPipelineDetails(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updatePipelineVariables") && server.tool("updatePipelineVariables",
      "Add, edit, or remove variables persisted on a pipeline definition (the 'Variables' panel in the ADO UI)",
      {
        pipelineId: z.number().describe("ID of the pipeline (build definition)"),
        variables: z.record(z.string(), z.object({
          value: z.string().optional().describe("New value for the variable"),
          isSecret: z.boolean().optional().describe("Whether the variable's value is a secret"),
          allowOverride: z.boolean().optional().describe("Whether the value can be overridden at queue time")
        })).optional().describe("Variables to add or edit, keyed by variable name"),
        removeVariables: z.array(z.string()).optional().describe("Names of variables to remove entirely")
      },
      async (params, extra) => {
        const result = await pipelinesTools.updatePipelineVariables(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("scheduleBuild") && server.tool("scheduleBuild",
      "Queue a new run of a pipeline, optionally overriding queue-time-enabled variables (e.g. TestCaseFilter) for this run only",
      {
        pipelineId: z.number().describe("ID of the pipeline (build definition) to queue"),
        variables: z.record(z.string(), z.string()).optional().describe("One-off variable overrides for this run only, e.g. { \"TestCaseFilter\": \"Priority=1\" }. Only takes effect for variables marked settable at queue time - check getPipelineDetails first."),
        sourceBranch: z.string().optional().describe("Branch to build, e.g. 'refs/heads/main'")
      },
      async (params, extra) => {
        const result = await pipelinesTools.scheduleBuild(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("listBuilds") && server.tool("listBuilds",
      "List past pipeline runs (builds), optionally filtered by pipeline, status, result, branch, or date range",
      {
        pipelineId: z.number().optional().describe("ID of the pipeline (build definition) to list runs for"),
        top: z.number().optional().describe("Maximum number of builds to return"),
        statusFilter: z.enum(['none', 'inProgress', 'completed', 'cancelling', 'postponed', 'notStarted', 'all']).optional().describe("Filter by build status"),
        resultFilter: z.enum(['none', 'succeeded', 'partiallySucceeded', 'failed', 'canceled']).optional().describe("Filter by build result"),
        branchName: z.string().optional().describe("Filter to builds of this branch"),
        minTime: isoDateString.optional().describe("Only return builds queued after this date/time"),
        maxTime: isoDateString.optional().describe("Only return builds queued before this date/time"),
        queryOrder: z.enum(['finishTimeAscending', 'finishTimeDescending', 'queueTimeAscending', 'queueTimeDescending', 'startTimeAscending', 'startTimeDescending']).optional().describe("Sort order for results")
      },
      async (params, extra) => {
        const result = await pipelinesTools.listBuilds(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getBuildDetails") && server.tool("getBuildDetails",
      "Get a single build's summary: status, result, timings, branch, and who requested it",
      {
        buildId: z.number().describe("ID of the build")
      },
      async (params, extra) => {
        const result = await pipelinesTools.getBuildDetails(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("cancelBuild") && server.tool("cancelBuild",
      "Cancel a queued (not yet started) or in-progress build. Fails if the build has already completed",
      {
        buildId: z.number().describe("ID of the build to cancel")
      },
      async (params, extra) => {
        const result = await pipelinesTools.cancelBuild(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getBuildTestResults") && server.tool("getBuildTestResults",
      "Get the pass/fail test results published by a build, including each test's automated test name and storage (assembly)",
      {
        buildId: z.number().describe("ID of the build"),
        outcomeFilter: z.array(z.enum(['none', 'passed', 'failed', 'inconclusive', 'timeout', 'aborted', 'blocked', 'notExecuted', 'warning', 'error', 'notApplicable', 'paused', 'inProgress', 'notImpacted'])).optional().describe("Only return results with these outcomes"),
        top: z.number().optional().describe("Maximum number of results to return")
      },
      async (params, extra) => {
        const result = await pipelinesTools.getBuildTestResults(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getBuildLogs") && server.tool("getBuildLogs",
      "List a build's logs, fetch one log's text lines, or download one (or all, zipped) to a local file",
      {
        buildId: z.number().describe("ID of the build"),
        logId: z.number().optional().describe("A specific log ID from a prior call without logId. Omit to list all logs, or (with savePath) to download all of them as a zip."),
        savePath: z.string().optional().describe("Local file path to download the log(s) to, instead of returning text inline")
      },
      async (params, extra) => {
        const result = await pipelinesTools.getBuildLogs(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getBuildArtifacts") && server.tool("getBuildArtifacts",
      "List a build's artifacts, or download one artifact's content zip to a local file",
      {
        buildId: z.number().describe("ID of the build"),
        artifactName: z.string().optional().describe("A specific artifact name from a prior call without artifactName. Omit to list all artifacts."),
        savePath: z.string().optional().describe("Local file path to download the named artifact's content zip to")
      },
      async (params, extra) => {
        const result = await pipelinesTools.getBuildArtifacts(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("associateAutomatedTestWithTestCase") && server.tool("associateAutomatedTestWithTestCase",
      "Associate an automated test published by a pipeline run with a Test Case work item - the same effect as the Test Case's Associated Automation > Browse flow in the ADO UI",
      {
        testCaseId: z.number().describe("ID of the Test Case work item"),
        buildId: z.number().describe("ID of the pipeline run (build) whose published test results contain the automated test"),
        automatedTestName: z.string().describe("Fully-qualified automated test name as it appears in getBuildTestResults, e.g. 'MyNamespace.MyClass.MyTestMethod'"),
        automatedTestType: z.string().optional().describe("Automated test type to record on the test case (defaults to 'Unit Test')")
      },
      async (params, extra) => {
        const result = await pipelinesTools.associateAutomatedTestWithTestCase(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    // Register Test Execution Tools
    allowedTools.has("listReleaseDefinitions") && server.tool("listReleaseDefinitions",
      "List release pipelines (classic releases) so one can be chosen for an automated test run",
      {
        searchText: z.string().optional().describe("Filter release pipelines by name"),
        top: limitSchema(1000).optional().describe("Maximum number to return")
      },
      async (params, extra) => {
        const result = await testExecutionTools.listReleaseDefinitions(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getReleaseDefinitionDetails") && server.tool("getReleaseDefinitionDetails",
      "Get a release pipeline's stages and build artifacts, to choose the stage and artifact for an automated test run",
      {
        releaseDefinitionId: idSchema.describe("ID of the release pipeline")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getReleaseDefinitionDetails(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("startTestRun") && server.tool("startTestRun",
      "Trigger a test run for one or more test cases. testType 'manual' + runner 'webApplication' creates an in-progress run whose steps and outcome are then recorded with setTestStepResults/setTestResultOutcome. testType 'automated' + runner 'releaseStage' creates a release from the chosen build and deploys only the chosen stage (requires buildPipelineId, releasePipelineId, stageName).",
      {
        planId: idSchema.describe("ID of the test plan"),
        testCaseIds: z.array(idSchema).min(1).describe("Test case work item IDs"),
        suiteId: idSchema.optional().describe("Suite containing the test cases; looked up within the plan when omitted"),
        testType: z.enum(["manual", "automated"]).describe("Type of test run"),
        runner: z.enum(["webApplication", "releaseStage"]).describe("webApplication for manual runs; releaseStage for automated runs"),
        runName: z.string().optional().describe("Name of the test run"),
        buildPipelineId: idSchema.optional().describe("Automated only: build pipeline that produced the tests"),
        buildId: idSchema.optional().describe("Automated only: build id (takes precedence over buildNumber)"),
        buildNumber: z.string().optional().describe("Automated only: build number such as '20261015.1'; latest completed build is used when neither buildId nor buildNumber is given"),
        releasePipelineId: idSchema.optional().describe("Automated only: release pipeline to run the tests in (see listReleaseDefinitions)"),
        stageName: z.string().optional().describe("Automated only: release pipeline stage to deploy and run (see getReleaseDefinitionDetails)"),
        artifactAlias: z.string().optional().describe("Automated only: alias of the release artifact bound to the build; must be a Build artifact of buildPipelineId. Inferred from buildPipelineId when omitted and only one artifact matches"),
        runIdVariableName: z.string().optional().describe("Automated only: release variable that receives the test run id (default 'test.RunId')")
      },
      async (params, extra) => {
        const result = await testExecutionTools.startTestRun(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestResult") && server.tool("getTestResult",
      "Read a test result: outcome, comment, failure analysis, associated bugs, attachments, and the test case steps with any recorded step outcomes",
      {
        iterationId: idSchema.optional().describe("Iteration (data row) of a parameterised result, as listed in getTestResult's iterations; not needed with one iteration. Without it, reads and bug reports use the first failing iteration, and changes refuse to guess"),
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        includeSteps: z.boolean().optional().describe("Include steps with recorded outcomes (default true)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getTestResult(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("setTestStepResults") && server.tool("setTestStepResults",
      "Mark selected steps (or all steps) of a test result as Passed or Failed, optionally with a comment on a failing step",
      {
        iterationId: idSchema.optional().describe("Iteration (data row) of a parameterised result, as listed in getTestResult's iterations; not needed with one iteration. Without it, reads and bug reports use the first failing iteration, and changes refuse to guess"),
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        steps: z.array(z.object({
          stepId: stepRefSchema.describe("Step id as shown by getTestResult: a number, or '3;5' for step 5 inside the shared step set at step 3"),
          outcome: z.enum(["Passed", "Failed"]),
          comment: z.string().optional().describe("Comment for the step, e.g. why it failed")
        })).optional().describe("Selected steps to mark"),
        allStepsOutcome: z.enum(["Passed", "Failed"]).optional().describe("Mark every step with this outcome (explicit steps entries still win)"),
        allStepsComment: z.string().optional().describe("Comment applied to every step marked through allStepsOutcome")
      },
      async (params, extra) => {
        const result = await testExecutionTools.setTestStepResults(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("setTestResultOutcome") && server.tool("setTestResultOutcome",
      "Mark the whole test result as Passed, Failed, Paused, Blocked or NotApplicable",
      {
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        outcome: z.enum(["Passed", "Failed", "Paused", "Blocked", "NotApplicable"]),
        comment: z.string().optional().describe("Comment for the result")
      },
      async (params, extra) => {
        const result = await testExecutionTools.setTestResultOutcome(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("completeTestRun") && server.tool("completeTestRun",
      "Complete a test run (state Completed) once its results are recorded",
      {
        runId: idSchema.describe("ID of the test run"),
        comment: z.string().optional().describe("Run comment")
      },
      async (params, extra) => {
        const result = await testExecutionTools.completeTestRun(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("addTestResultAttachment") && server.tool("addTestResultAttachment",
      "Upload a screenshot, screen recording or other file (from a local path) to a test result, or to one of its steps. Capturing the screen is the caller's job; this uploads the file.",
      {
        iterationId: idSchema.optional().describe("Iteration (data row) of a parameterised result, as listed in getTestResult's iterations; not needed with one iteration. Without it, reads and bug reports use the first failing iteration, and changes refuse to guess"),
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        filePath: z.string().optional().describe("Absolute path of the local file to upload"),
        base64Content: z.string().optional().describe("Small file content as base64 (alternative to filePath; requires fileName)"),
        fileName: z.string().optional().describe("File name; defaults to the file's own name"),
        comment: z.string().optional().describe("Comment stored with the attachment"),
        kind: z.enum(["screenshot", "recording", "file"]).optional().describe("Validates the file type: screenshot = image, recording = video"),
        stepId: stepRefSchema.optional().describe("Attach to this step instead of the whole result (number, or '3;5' for a step inside a shared step set)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.addTestResultAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("addTestRunAttachment") && server.tool("addTestRunAttachment",
      "Upload a file to a test run (as opposed to a single result)",
      {
        runId: idSchema.describe("ID of the test run"),
        filePath: z.string().optional().describe("Absolute path of the local file to upload"),
        base64Content: z.string().optional().describe("Small file content as base64 (alternative to filePath; requires fileName)"),
        fileName: z.string().optional().describe("File name; defaults to the file's own name"),
        comment: z.string().optional().describe("Comment stored with the attachment")
      },
      async (params, extra) => {
        const result = await testExecutionTools.addTestRunAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("listTestRunAttachments") && server.tool("listTestRunAttachments",
      "List the files attached to a test run (id, file name, size, comment, date)",
      {
        runId: idSchema.describe("ID of the test run")
      },
      async (params, extra) => {
        const result = await testExecutionTools.listTestRunAttachments(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestRunAttachment") && server.tool("getTestRunAttachment",
      "Download a test run attachment to a file (savePath), or return small ones inline as base64. savePath must be inside an allowed folder, and an existing file is not replaced unless overwrite is true. Get the attachment id from listTestRunAttachments.",
      {
        runId: idSchema.describe("ID of the test run"),
        attachmentId: idSchema.describe("ID of the attachment (from listTestRunAttachments)"),
        savePath: z.string().optional().describe("File to write to, or an existing folder (the file is then saved as '<attachment id>-<its name, made safe>'); must be inside an allowed folder. Without it the content comes back as base64 if it is under 64 KB"),
        overwrite: z.boolean().optional().describe("Replace a file that already exists at savePath (default false)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getTestRunAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("deleteTestRunAttachment") && server.tool("deleteTestRunAttachment",
      "Permanently delete one attachment of a test run. This cannot be undone. Get the attachment id from listTestRunAttachments.",
      {
        runId: idSchema.describe("ID of the test run"),
        attachmentId: idSchema.describe("ID of the attachment to delete (from listTestRunAttachments)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.deleteTestRunAttachment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("addTestResultComment") && server.tool("addTestResultComment",
      "Add a comment to a test result (appended to the existing comment unless replace is true)",
      {
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        comment: z.string().describe("Comment text"),
        replace: z.boolean().optional().describe("Replace the existing comment instead of appending")
      },
      async (params, extra) => {
        const result = await testExecutionTools.addTestResultComment(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateTestResultAnalysis") && server.tool("updateTestResultAnalysis",
      "Edit the analysis of a test result: analysis owner, failure type, resolution and comment",
      {
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        failureType: z.enum(["None", "Regression", "New Issue", "Known Issue", "Unknown"]).optional(),
        resolutionState: z.string().optional().describe("Resolution name as listed by listTestResolutionStates (case-insensitive); they differ per project"),
        resolutionStateId: idSchema.optional().describe("Resolution state id; takes precedence over resolutionState"),
        analysisOwner: z.object({
          id: z.string().optional().describe("Identity GUID (preferred)"),
          uniqueName: z.string().optional().describe("Account/email; looked up among the project teams' members when id is omitted"),
          displayName: z.string().optional().describe("Display name; looked up among the project teams' members when id is omitted")
        }).optional().describe("Analysis owner"),
        comment: z.string().optional().describe("Analysis comment; this is the result's comment field, so it replaces the existing result comment")
      },
      async (params, extra) => {
        const result = await testExecutionTools.updateTestResultAnalysis(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("listTestResolutionStates") && server.tool("listTestResolutionStates",
      "List the project's test resolution states (id and name) that updateTestResultAnalysis accepts",
      {},
      async (params, extra) => {
        const result = await testExecutionTools.listTestResolutionStates(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("assignTester") && server.tool("assignTester",
      "Assign a tester to the test points of the given test cases in a plan",
      {
        planId: idSchema.describe("ID of the test plan"),
        testCaseIds: z.array(idSchema).min(1).describe("Test case work item IDs"),
        suiteId: idSchema.optional().describe("Suite containing the test cases; looked up within the plan when omitted"),
        tester: z.object({
          id: z.string().optional().describe("Identity GUID (preferred)"),
          uniqueName: z.string().optional().describe("Account/email; looked up among the project teams' members when id is omitted"),
          displayName: z.string().optional()
        }).describe("Tester identity")
      },
      async (params, extra) => {
        const result = await testExecutionTools.assignTester(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("resetTestToActive") && server.tool("resetTestToActive",
      "Reset the test points of the given test cases in a plan back to Active so they can be run again",
      {
        planId: idSchema.describe("ID of the test plan"),
        testCaseIds: z.array(idSchema).min(1).describe("Test case work item IDs"),
        suiteId: idSchema.optional().describe("Suite containing the test cases; looked up within the plan when omitted")
      },
      async (params, extra) => {
        const result = await testExecutionTools.resetTestToActive(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestRuns") && server.tool("getTestRuns",
      "List test runs (filter by plan, build, owner, automated) or, with runId, read one run and its results",
      {
        runId: idSchema.optional().describe("Return this single run with its results"),
        planId: idSchema.optional(),
        buildId: idSchema.optional(),
        owner: z.string().optional().describe("Run owner display name or unique name"),
        automated: z.boolean().optional(),
        top: limitSchema(1000).optional().describe("Maximum runs to return (default 25)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getTestRuns(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestPoints") && server.tool("getTestPoints",
      "Read test points (test case + configuration pairs in a suite): current outcome, tester, last run and result, last reset to Active, optionally with recent results per point. Give testCaseIds, a suiteId, or both.",
      {
        planId: idSchema.describe("ID of the test plan"),
        suiteId: idSchema.optional().describe("Suite to read; every point in it when testCaseIds is omitted"),
        testCaseIds: z.array(idSchema).optional().describe("Only the points of these test cases; their suites are looked up in the plan when suiteId is omitted"),
        includeHistory: z.boolean().optional().describe("Also return recent results recorded against each point"),
        historyTop: limitSchema(200).optional().describe("Results per point when includeHistory is set (default 10)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getTestPoints(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("getTestCaseExecutionHistory") && server.tool("getTestCaseExecutionHistory",
      "Find the runs and results recorded for a test case, newest first",
      {
        testCaseId: idSchema.describe("Test case work item ID"),
        planId: idSchema.optional().describe("Limit to this test plan"),
        top: limitSchema(1000).optional().describe("Maximum results to return (default 25)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.getTestCaseExecutionHistory(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("linkTestRunToWorkItems") && server.tool("linkTestRunToWorkItems",
      "Link a test run (or one of its results) to existing work items. Bugs are recorded as the result's associated bugs; other work item types (User Story, Task, PBI...) get only a hyperlink to the run, which every work item gets",
      {
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.optional().describe("Link only this result; every result in the run when omitted"),
        workItemIds: z.array(idSchema).min(1).describe("Work item IDs to link"),
        addRunHyperlink: z.boolean().optional().describe("Also add a hyperlink to the run on each work item (default true)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.linkTestRunToWorkItems(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("createBugFromTestRun") && server.tool("createBugFromTestRun",
      "Create a Bug from a test result, with repro steps built from the test steps, outcomes, failing-step comments and attachments, linked to the test result, test case and run",
      {
        iterationId: idSchema.optional().describe("Iteration (data row) of a parameterised result, as listed in getTestResult's iterations; not needed with one iteration. Without it, reads and bug reports use the first failing iteration, and changes refuse to guess"),
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        title: z.string().optional().describe("Bug title; defaults to '<test case title> failed'"),
        areaPath: z.string().optional().describe("Defaults to the test case's area path"),
        iterationPath: z.string().optional().describe("Defaults to the test case's iteration path"),
        assignedTo: z.string().optional(),
        severity: z.string().optional().describe("e.g. '2 - High'"),
        priority: prioritySchema.optional(),
        additionalDetails: z.string().optional().describe("Extra text placed above the generated repro steps")
      },
      async (params, extra) => {
        const result = await testExecutionTools.createBugFromTestRun(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    allowedTools.has("updateBugWithTestRun") && server.tool("updateBugWithTestRun",
      "Add a test result's details to an existing bug as a comment (and optionally append to Repro Steps), and link the bug to the result, test case and run",
      {
        iterationId: idSchema.optional().describe("Iteration (data row) of a parameterised result, as listed in getTestResult's iterations; not needed with one iteration. Without it, reads and bug reports use the first failing iteration, and changes refuse to guess"),
        runId: idSchema.describe("ID of the test run"),
        resultId: idSchema.describe("ID of the test result within the run (from startTestRun or getTestRuns)"),
        bugId: idSchema.describe("ID of the existing bug"),
        additionalDetails: z.string().optional().describe("Extra text placed above the generated summary"),
        appendToReproSteps: z.boolean().optional().describe("Also append the details to the bug's Repro Steps field (default false)")
      },
      async (params, extra) => {
        const result = await testExecutionTools.updateBugWithTestRun(params);
        return {
          content: result.content,
          rawData: result.rawData,
          isError: result.isError
        };
      }
    );

    // Create a transport (use stdio for simplicity)
    const transport = new StdioServerTransport();
    
    // Connect to the transport and start listening
    await server.connect(transport);

  } catch (error) {
    console.error('Error starting MCP server:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Set an environment variable to indicate we're in MCP mode
// This helps prevent console.log from interfering with stdio communication
process.env.MCP_MODE = 'true';

// Run the server
main(); 