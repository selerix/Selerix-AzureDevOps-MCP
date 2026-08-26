# Tool Registration Guide

This document provides instructions on how to register new tools in the Azure DevOps MCP integration.

## How to Register a New Tool

To register a new tool, you need to add it to the `index.ts` file in the main source directory. 

Here's the basic template for registering a tool:

```typescript
server.tool("toolName", 
  "Tool description",
  {
    // Parameters schema using zod
    paramName: z.string().describe("Parameter description"),
    optionalParam: z.number().optional().describe("Optional parameter description")
  },
  async (params, extra) => {
    // Call the appropriate tool method
    const result = await toolsInstance.toolMethod(params);
    return {
      content: result.content,
      rawData: result.rawData,
      isError: result.isError
    };
  }
);
```

## Example: Registering a New Work Item Tool

```typescript
server.tool("updateWorkItemState", 
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
```

## Available Tool Instances

The MCP server initializes four main tool instances, each handling different aspects of Azure DevOps:

1. `workItemTools` - For work item management operations
2. `boardsSprintsTools` - For board and sprint management operations
3. `projectTools` - For project management operations
4. `gitTools` - For Git repository operations
5. `testingCapabilitiesTools` - For testing capabilities operations
6. `devSecOpsTools` - For DevSecOps operations
7. `artifactManagementTools` - For artifact management operations
8. `aiAssistedDevelopmentTools` - For AI-assisted development operations

## Parameter Types

Use the Zod library to define parameter types and validations:

- `z.string()` - String parameter
- `z.number()` - Number parameter
- `z.boolean()` - Boolean parameter
- `z.array(z.string())` - Array of strings
- `z.record(z.any())` - Object with any values
- `z.enum(['option1', 'option2'])` - Enumerated values
- Add `.optional()` for optional parameters
- Add `.describe("Description")` to describe the parameter

### Important: Using Enums for Type Safety

When registering tools, always match the parameter types with the interface definitions in the `Interfaces` directory. For enum parameters, make sure to use `z.enum()` with the exact values expected by the interface. This ensures type safety and prevents TypeScript errors during build.

Example:

```typescript
server.tool("createProject", 
  "Create a new project",
  {
    name: z.string().describe("Name of the project"),
    description: z.string().optional().describe("Description of the project"),
    // Use z.enum() with the exact values expected by CreateProjectParams
    visibility: z.enum(['private', 'public']).optional().describe("Visibility of the project"),
    capabilities: z.record(z.any()).optional().describe("Project capabilities")
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
```

## Common Enum Values

Here are some common enum values used in the Azure DevOps APIs:

- Project state filter: `['all', 'createPending', 'deleted', 'deleting', 'new', 'unchanged', 'wellFormed']`
- Project visibility: `['private', 'public']`
- Pull request merge strategy: `['noFastForward', 'rebase', 'rebaseMerge', 'squash']`
- Pull request status: `['abandoned', 'active', 'completed', 'notSet']`

## Complete List of Tools

Here's a list of all the tools mentioned in the README.md file:

### Work Item Tools
- `listWorkItems`
- `getWorkItemById`
- `searchWorkItems`
- `getRecentlyUpdatedWorkItems`
- `getMyWorkItems`
- `createWorkItem`
- `updateWorkItem`
- `addWorkItemComment`
- `updateWorkItemState`
- `assignWorkItem`
- `createLink`
- `bulkCreateWorkItems`
- `uploadAttachment`
- `addWorkItemAttachment`
- `listWorkItemAttachments`

### Boards & Sprints Tools
- `getBoards`
- `getBoardColumns`
- `getBoardItems`
- `moveCardOnBoard`
- `getSprints`
- `getCurrentSprint`
- `getSprintWorkItems`
- `getSprintCapacity`
- `getTeamMembers`

### Project Tools
- `listProjects`
- `getProjectDetails`
- `createProject`
- `getAreas`
- `getIterations`
- `createArea`
- `createIteration`
- `getProcesses`
- `getWorkItemTypes`
- `getWorkItemTypeFields`

### Git Tools
- `listRepositories`
- `getRepository`
- `createRepository`
- `listBranches`
- `searchCode`
- `browseRepository`
- `getFileContent`
- `getCommitHistory`
- `listPullRequests`
- `createPullRequest`
- `getPullRequest`
- `getPullRequestComments`
- `approvePullRequest`
- `mergePullRequest`

If you need to add more tools, make sure to implement them in the appropriate tools class first, and then register them in the `index.ts` file following the pattern shown above. 