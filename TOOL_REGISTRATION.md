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

The MCP server initializes ten main tool instances, each handling different aspects of Azure DevOps:

1. `workItemTools` - For work item management operations
2. `boardsSprintsTools` - For board and sprint management operations
3. `projectTools` - For project management operations
4. `gitTools` - For Git repository operations
5. `testingCapabilitiesTools` - For testing capabilities operations
6. `testPlansTools` - For test plan, test suite, and test case management operations
7. `devSecOpsTools` - For DevSecOps operations
8. `artifactManagementTools` - For artifact management operations
9. `aiAssistedDevelopmentTools` - For AI-assisted development operations
10. `pipelinesTools` - For pipeline/build scheduling, variables, results, and test-case automation association

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

## Gotcha: HTML-format fields double-escape reserved characters

A fixed set of work item fields are stored by Azure DevOps as HTML, even though the WIT REST API
accepts and returns their value as a plain string. A work item response reports this per field via
`multilineFieldsFormat`, e.g. `{ "Microsoft.VSTS.TCM.Steps": "html" }`. Known fields in this
category (also exported as `HTML_FORMAT_WORK_ITEM_FIELDS` from `src/utils/richTextFields.ts`):

- `System.Description`
- `Microsoft.VSTS.Common.AcceptanceCriteria`
- `Microsoft.VSTS.TCM.ReproSteps`
- `Microsoft.VSTS.TCM.Steps`
- `Microsoft.VSTS.TCM.SystemInfo`

When a value written to one of these fields does **not** already look like HTML (no recognizable
tags), Azure DevOps runs it through its own HTML-encode pass server-side before storing it -
turning a literal `>` into the entity `&gt;`. For `Microsoft.VSTS.TCM.Steps` specifically, that
HTML-encoded text is itself a text node inside the field's outer step-list XML
(`<steps><step><parameterizedString>...</parameterizedString></step></steps>`), so the `&` from the
newly-added `&gt;` then *also* needs XML-escaping to keep that outer document well-formed -
producing `&amp;gt;` in the value a subsequent `getWorkItemById` returns instead of the intended
`>`.

This is confirmed Azure DevOps server-side behavior (verified live against
`dev.azure.com/selerix/Engineering`), not a bug in this server or in `azure-devops-node-api`: the
HTTP request body is built with a plain `JSON.stringify` with no escaping of any kind
(`typed-rest-client`'s `RestClient.create`/`replace`), so pre-escaping a value before calling
`createWorkItem`/`updateWorkItem` cannot avoid it either - XML-escaping `>` as `&gt;` before sending
is indistinguishable, once XML-parsed, from sending the literal `>` character, and both get the
same server-side HTML-encode treatment. It also only triggers on reserved characters (`&`, `<`,
`>`): plain text with none of those round-trips unchanged regardless of HTML wrapping, which is why
existing hand-authored Shared Steps in this org that phrase things with `/` instead of `>` (e.g.
"Go to Case Setup / Benefit Plans") never hit this.

The one input shape that reliably survives untouched is text that already looks like real HTML -
e.g. wrapped in `<div><p>...</p></div>`, with any literal `>`/`&` inside it pre-encoded as
`&gt;`/`&amp;`. Azure DevOps recognizes that as already-HTML and passes it through byte-for-byte.
Use the helpers in `src/utils/richTextFields.ts` to build that shape:

```typescript
import { escapeXmlText, wrapPlainTextAsHtml } from './utils/richTextFields';

// Flat HTML field (System.Description, AcceptanceCriteria, ReproSteps): pass wrapPlainTextAsHtml's
// output directly as the field value.
const description = wrapPlainTextAsHtml('Steps to reproduce:\n\n1. Open Case Setup > Benefit Plans');

// Microsoft.VSTS.TCM.Steps wraps its HTML inside another layer of XML, so the HTML needs a second,
// outer XML-escaping pass before it goes into a <parameterizedString> element.
const stepText = escapeXmlText(wrapPlainTextAsHtml('Go to Case Setup > Benefit Plans'));
const steps = `<steps id="0" last="1"><step id="1" type="ActionStep"><parameterizedString isformatted="true">${stepText}</parameterizedString><parameterizedString isformatted="true"/></step></steps>`;
```

If a plain-text value has no `&`, `<`, or `>` in it, none of this is necessary - it round-trips as-is.

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
- `getWorkItemComments`
- `updateWorkItemComment`
- `deleteWorkItemComment`
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

### Pipelines Tools
- `listPipelines`
- `getPipelineDetails`
- `updatePipelineVariables`
- `scheduleBuild`
- `listBuilds`
- `getBuildDetails`
- `cancelBuild`
- `getBuildTestResults`
- `getBuildLogs`
- `getBuildArtifacts`
- `associateAutomatedTestWithTestCase`

### Test Execution Tools
Run test cases, record results, and file bugs (`src/Services/TestExecutionService.ts`).

- Run: `startTestRun`, `completeTestRun`, `listReleaseDefinitions`, `getReleaseDefinitionDetails`
- Record: `getTestResult`, `setTestStepResults`, `setTestResultOutcome`, `addTestResultComment`,
  `addTestResultAttachment`, `addTestRunAttachment`, `listTestRunAttachments`, `getTestRunAttachment`,
  `deleteTestRunAttachment`, `updateTestResultAnalysis` (analysis owner, failure type, resolution, comment),
  `listTestResolutionStates`
- Plan points: `assignTester`, `resetTestToActive`
- History and links: `getTestRuns`, `getTestCaseExecutionHistory`, `getTestPoints`, `linkTestRunToWorkItems`
- Bugs: `createBugFromTestRun`, `updateBugWithTestRun`

Notes:
- `startTestRun` with `testType: "manual"` / `runner: "webApplication"` creates an in-progress run.
  With `testType: "automated"` / `runner: "releaseStage"` it creates a release from the chosen build
  with every stage manual, then deploys only the chosen stage. The run id is passed to the release
  in the variable `test.RunId` (override with `runIdVariableName`); the stage's test task must be
  set up to run that test run.
- Screenshots and recordings are uploaded from a local file path. The server cannot capture the
  screen itself.
- Step outcomes are stored per step under an 8-digit lowercase hex action path, as the web UI writes them.
  A shared step set is expanded into a reference row (step id `2`) plus one row per step inside it
  (step id `"2;1"`, `"2;2"`, ...). Marking the reference marks only that row; use `allStepsOutcome`
  or the `"parent;child"` ids to mark the steps inside it.
- `assignTester` takes the tester's identity GUID. An email or display name is looked up among the
  members of the project's teams (Azure DevOps itself rejects anything but a GUID).
- **Corporate TLS inspection (Zscaler) blocks some of these tools.** `deleteTestRunAttachment` goes
  through the Test Results service (`vstmr.dev.azure.com`), and `listReleaseDefinitions`,
  `getReleaseDefinitionDetails` and automated `startTestRun` go through the Release service
  (`vsrm.dev.azure.com`). Zscaler re-signs those two hosts with its own root certificate, which
  Node.js does not trust, so the calls fail with `unable to get local issuer certificate`. The
  other test-execution tools use `dev.azure.com`, which is not inspected, and are unaffected.
  - Status: the delete call hits this error on the corporate network (confirmed live); it has not
    yet succeeded through the tool, only through the Azure DevOps web UI. The release calls have
    not been run live and are expected to fail the same way.
  - Fix, outside this repo: DevOps either bypasses TLS inspection for those hosts or makes Node
    trust the Zscaler root (`NODE_EXTRA_CA_CERTS`). The request is in
    [docs/devops-request-ado-tls-inspection.md](docs/devops-request-ado-tls-inspection.md).
  - Once that is done, retest `deleteTestRunAttachment` and the release tools live. No code
    change is expected.

If you need to add more tools, make sure to implement them in the appropriate tools class first, and then register them in the `index.ts` file following the pattern shown above. 