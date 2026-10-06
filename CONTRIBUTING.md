# Contributing

This is Selerix's fork of the Azure DevOps MCP server. Contributors build features on a branch and
open a PR into `main`. A maintainer merges and publishes the package to the Selerix ADO Artifacts feed.

## 1. Setup

- Use **Node 20** (`nvm use 20.20.2`). Older Node versions break `npm install`.
- Run `npm install`.
- To run the server against a real org, set the Azure DevOps env vars (see `.env.cloud.example` /
  `.env.on-premises.example`). Never commit a `.env` file or a PAT.

## 2. Branching

- Branch from an up-to-date `main` as `feature/<short-name>` (or `fix/<short-name>` for bug fixes).
- Never push directly to `main`. A ruleset requires a PR with one approval and blocks force-push and deletion.
- Don't touch `stage` unless a maintainer asks. It carries Selerix-specific work.

## 3. Building a feature

- Follow the three-layer pattern (see `CLAUDE.md`):
  - types in `src/Interfaces/<Domain>.ts`
  - logic in `src/Services/<Domain>Service.ts`
  - a thin wrapper in `src/Tools/<Domain>Tools.ts` that returns `formatMcpResponse` or `formatErrorResponse`
- Register every new tool in `src/index.ts` with `server.tool(...)`, gated by
  `allowedTools.has("toolName") &&`. Use the template in `TOOL_REGISTRATION.md`.
- Use `z.enum([...])` (not `z.string()`) wherever the TS interface has a union type.
- Add Jest tests under `tests/` that cover error and edge paths, not only the happy path.
- Update `Tools.md` and `CHANGELOG.md` for any new tool.
- Don't bump the version in a feature PR. The maintainer does that at release.

## 4. Before opening a PR

- `npm run build` and `npm test` must both pass.
- Keep commits small, with imperative messages (e.g. `Add cancelBuild tool to Pipelines domain`).
- Review your own diff and fix any findings before requesting review.

## 5. Pull request

- Open the PR against `main`. Describe what the tool does and how you tested it, ideally against a real org.
- The PR needs **1 approving review from someone other than the author**. Address comments by pushing
  fixes to the same branch, then re-request review.
- The maintainer merges once it is approved.

## 6. Release and publish to ADO (maintainer only)

1. Pull `main`, then add a `chore(release): bump version to X.Y.Z` commit (minor for new tools, patch for fixes).
2. Check the version isn't already on the feed:

   ```bash
   npm view @selerix/azuredevops-mcp-server versions --registry https://pkgs.dev.azure.com/selerix/_packaging/Selerix/npm/registry/
   ```

3. Run `npm publish` under Node 20. `publishConfig` already targets the ADO feed
   (`https://pkgs.dev.azure.com/selerix/_packaging/Selerix/npm/registry/`) and `prepublishOnly` runs the build.

Publishing needs a PAT with **Packaging Read & Write** scope in the user-level `~/.npmrc`. Never put it in
the repo, and don't repoint `publishConfig` or `.npmrc` at GitHub Packages.
