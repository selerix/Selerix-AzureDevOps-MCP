# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stdio-based Model Context Protocol (MCP) server (`@ryancardin/azuredevops-mcp-server`) that
exposes Azure DevOps (Services/cloud and on-premises Server/TFS) work items, boards/sprints,
projects, git, testing, DevSecOps, artifact-management, and AI-assisted-dev operations as MCP
tools. This is **Selerix's fork** (`selerix/Selerix-AzureDevOps-MCP`) of the upstream
`RyanCardin15/AzureDevOps-MCP` project — history is regularly merged in from `origin/main`
(upstream), with Selerix-specific work happening on the `stage` branch.

This is the MCP server referenced by `doc/azure-devops-mcp-setup.md` in the BenSelect repo, which
documents running it under Node 20 side-by-side with BenSelect's own Node 10.2x toolchain.

## Commands

```bash
npm install              # install dependencies
npm run build             # tsc build -> dist/
npm run build:ignore-errors  # tsc --skipLibCheck --noEmitOnError false (bypass TS errors to still emit dist/)
npm run dev                # run directly from src/ via ts-node (src/index.ts)
npm start                  # run the built server: node dist/index.js
```

There is no test suite (`npm test` is a stub that exits 1) and no lint script.

To run the server locally you need Azure DevOps env vars set (see `.env.cloud.example` /
`.env.on-premises.example`, or export them directly) — `config.ts` throws at startup if
`AZURE_DEVOPS_ORG_URL` / `AZURE_DEVOPS_PROJECT` are missing or still contain placeholder values.
`npm run dev` is the fastest way to exercise a change against a real org before wiring it into an
MCP client, since the server talks stdio and isn't otherwise browsable.

## Architecture

Three-layer structure under `src/`, one set of files per functional domain (WorkItems,
BoardsAndSprints, Project, CodeAndRepositories/Git, TestingCapabilities, DevSecOps,
ArtifactManagement, AIAssisted):

```
src/Interfaces/<Domain>.ts   → param/response type definitions (plain TS interfaces)
src/Services/<Domain>Service.ts → talks to Azure DevOps via azure-devops-node-api
src/Tools/<Domain>Tools.ts   → thin wrapper: calls the Service, formats an McpResponse
src/index.ts                 → registers each tool with the MCP server (zod schemas + handler)
src/config.ts                 → env var loading/validation, auth-type resolution, ALLOWED_TOOLS
```

Every `Services/*Service.ts` extends `AzureDevOpsService` (`src/Services/AzureDevOpsService.ts`),
which owns the `azure-devops-node-api` `WebApi` connection and builds the right auth handler
(PAT / NTLM / Basic / Entra) and base URL (on-premises appends `/{collection}`) from
`AzureDevOpsConfig`.

Every `Tools/*Tools.ts` method follows the same shape: call the paired Service method, wrap the
result with `formatMcpResponse(data, message)` from `src/Interfaces/Common.ts`, and catch errors
into `formatErrorResponse(error)`. Keep new tool methods in this shape — the MCP response contract
(`{ content, rawData, isError }`) is defined once in `Common.ts` and consumed uniformly by
`index.ts`.

### Tool registration is manual and explicit

Adding a tool method to a `Tools/*.ts` class does **not** expose it — it must also be registered in
`src/index.ts` with a `server.tool(name, description, zodSchema, handler)` call, gated by
`allowedTools.has("toolName") &&`. See `TOOL_REGISTRATION.md` for the template. When defining the
zod schema, mirror the parameter types in the matching `src/Interfaces/<Domain>.ts` file exactly —
in particular use `z.enum([...])` (not `z.string()`) for any field that's a TS union/enum there, or
the build breaks.

### `ALLOWED_TOOLS` / tool-method arrays

Each `Tools/*.ts` file ends with an exported `<Domain>ToolMethods` array, built by
`getClassMethods(prototype)` (`src/utils/getClassMethods.ts`), i.e. every public method name on
that class. `config.ts` concatenates all of these into `ALL_ALLOWED_TOOLS` and `getAllowedTools()`
reads `process.env.ALLOWED_TOOLS` (comma-separated) to produce the `Set<string>` that `index.ts`
checks before registering each tool — this is how a client can restrict which tools are live
(useful for cutting context/token usage). If `ALLOWED_TOOLS` is unset, every tool is registered.

### Auth & environment resolution (`config.ts`)

`getAzureDevOpsConfig()` branches on `AZURE_DEVOPS_IS_ON_PREMISES` and `AZURE_DEVOPS_AUTH_TYPE`
(`pat` | `ntlm` | `basic` | `entra`) to build the `auth` sub-object; `entra` (Azure Identity /
`DefaultAzureCredential`, via `EntraAuthHandler`) is cloud-only. It also rejects placeholder values
left over from the example env files (`your-organization`, `your-personal-access-token`, etc.) so
a copy-pasted `.env` fails fast instead of hitting the API with garbage.

`loadEnvFile()` in `config.ts` searches, in order: `./.env`, `<dist-dir>/../.env`,
`$(pwd)/.env`, `~/.azuredevops.env` — relevant when debugging "config not found" issues, since
which `.env` wins depends on the current working directory at launch, not just repo location.

### Distribution

Published to npm as `@ryancardin/azuredevops-mcp-server` and consumed via `npx` by MCP clients
(Cursor, Claude Desktop/Code, Smithery). `smithery.yaml` + `Dockerfile` define the Smithery-hosted
build/run path (`node:lts-alpine`, `npm run build` then `npm run start`) — the `configSchema` there
must stay in sync with the env vars `config.ts` actually reads.
