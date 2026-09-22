# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.1] - 2026-09-22

Azure DevOps auto-HTML-encodes plain text written to a handful of fields it treats as HTML
server-side (`Microsoft.VSTS.TCM.Steps`, `System.Description`, `Microsoft.VSTS.Common.AcceptanceCriteria`,
`Microsoft.VSTS.TCM.ReproSteps`, `Microsoft.VSTS.TCM.SystemInfo`) — for an XML-wrapped field like
`Microsoft.VSTS.TCM.Steps` that produces a confusing extra layer of escaping on read-back (a
literal `>` comes back as `&amp;gt;`). Confirmed live against a real org that this is genuine Azure
DevOps server-side behavior, not something fixable in this server: `createWorkItem`/`updateWorkItem`
and their dependencies (`azure-devops-node-api`, `typed-rest-client`) pass field values through
with zero escaping of any kind.

### Added

- **`src/utils/richTextFields.ts`** — `HTML_FORMAT_WORK_ITEM_FIELDS`, `looksLikeHtml`,
  `escapeXmlText`, and `wrapPlainTextAsHtml` helpers for building the one input shape
  (already-HTML content) that survives Azure DevOps's auto-encoding untouched.
- Warnings on `createWorkItem`, `updateWorkItem`, and `bulkCreateWorkItems`'s tool descriptions and
  affected field parameters (self-contained, since remote MCP clients can't read this repo's docs),
  so MCP clients — including AI agents — see the gotcha and the fix before hitting it.
- A "Gotcha" section in `TOOL_REGISTRATION.md` with the full writeup and usage examples.

## [1.3.1] - 2026-09-16

`listWorkItemAttachments` only ever returned metadata (name/URL/size) - there was no way to read
what a screenshot referenced in a bug's Repro Steps, or a test step's evidence, actually shows.

### Added

- **`getWorkItemAttachment`** — download an attachment's actual content, given the GUID `id`
  returned by `listWorkItemAttachments`. Uses the same authenticated `azure-devops-node-api`
  connection as every other tool (PAT/NTLM/Basic/Entra, on-premises or cloud).
  - `savePath` streams content straight to disk for anything non-trivial in size. It's written
    to a collision-resistant temporary sibling first and renamed into place only once the
    download fully succeeds, so a transient network error (or a failed rename) never truncates
    an existing file or leaves a partial one behind, and two concurrent downloads to the same
    `savePath` can't clobber each other.
  - Without `savePath`, content is buffered (aborting as soon as it exceeds the limit, rather
    than after buffering the whole thing) and returned inline as `base64Content`, but rejected
    above the same 1 KB decoded limit `uploadAttachment` already enforces.

## [1.3.0] - 2026-09-16

Adds real Test Plan/Suite/Test Case management. Testing-capabilities tools like
`runAutomatedTests` or `getTestHealthDashboard` were mocked and unrelated to Azure DevOps Test
Plans; there was previously no way to read or manage Test Plan/Suite structure at all (suite
membership isn't exposed through work item links or WIQL — it lives in a separate Test
Management API).

### Added

- **`createTestPlan`**, **`getTestPlans`**, **`getTestPlanById`**, **`updateTestPlan`**,
  **`deleteTestPlan`** — full CRUD for test plans. `updateTestPlan` backfills the
  SDK-required `name`/`iteration` fields from the existing plan when a caller only wants to
  change another field, instead of sending them as `undefined`.
- **`createTestSuite`**, **`getTestSuites`**, **`getTestSuiteById`**, **`updateTestSuite`**,
  **`deleteTestSuite`** — full CRUD for test suites, including `requirementTestSuite` (requires
  `requirementId`) and `dynamicTestSuite` (requires `queryString`).
- **`addTestCasesToSuite`**, **`getTestCasesFromSuite`**, **`getSuitesForTestCase`**,
  **`removeTestCasesFromSuite`**, **`deleteTestCase`** — manage which test cases belong to a
  suite, look up which suites contain a given test case, and delete a test case work item.
- `getTestPlans`, `getTestSuites`, and `getTestCasesFromSuite` return `{ items, continuationToken }`
  instead of a bare array. Azure DevOps returns the next-page token in the
  `x-ms-continuationtoken` response header, which `azure-devops-node-api`'s generated
  `ITestPlanApi` methods discard — these three replay the same request via the API client's
  public `vsoClient`/`rest`/`createRequestOptions`/`formatResponse` members and read that header
  directly so multi-page suites/plans/test-case lists can actually be paged through.
- `startDate`/`endDate` on `createTestPlan`/`updateTestPlan` are validated as ISO date/datetime
  strings at the MCP boundary (via `z.string().date()`/`z.string().datetime({ offset: true })`,
  compatible with both Zod 3.25+ and Zod 4), rejecting locale-style or impossible calendar dates
  instead of silently becoming `Invalid Date`.

## [1.2.0] - 2026-09-15

Rounds out comment support for work items: the Discussion tab was previously write-only.

### Added

- **`getWorkItemComments`** — read the comments on a work item's Discussion tab, with `top` and
  `order` (ascending/descending by creation date) options, and pagination via `continuationToken`
  for work items with more than one page of comments.
- **`updateWorkItemComment`** — edit the text of an existing comment.
- **`deleteWorkItemComment`** — delete a comment from a work item.

All three route through the same `azure-devops-node-api` `WorkItemTrackingApi` connection every
other tool in this project uses (`getComments` / `updateComment` / `deleteComment`), which were
already available in the client but not previously wired up alongside the existing
`addWorkItemComment`.

## [1.1.1] - 2026-08-28

### Fixed

- `uploadAttachment` could crash the entire stdio server: `existsSync` only catches a missing
  `filePath` at check time, not a directory path, a permissions error, or a file removed between
  the check and the read (TOCTOU) — and `pipe()` never forwards a source stream's errors to its
  destination. Any of those now reject the call with a normal error instead of surfacing as an
  unhandled `'error'` event.
- `uploadAttachment` now rejects immediately under NTLM authentication
  (`AZURE_DEVOPS_AUTH_TYPE=ntlm`) instead of silently creating an **empty** attachment.
  `typed-rest-client`'s NTLM handler sends every request anonymously first, and on the resulting
  401 challenge re-pipes the same, already-drained file stream into the retried request.
- A failed upload no longer leaks an open file descriptor: the content stream is now destroyed in
  the `catch` path, so (on Windows in particular) the source file isn't left locked after a failed
  upload.

## [1.1.0] - 2026-08-26

First tagged release of Selerix's fork of `RyanCardin15/AzureDevOps-MCP`. Adds end-to-end
attachment support for Azure DevOps / TFS work items, along with the test infrastructure this
project didn't previously have.

### Added

- **`uploadAttachment`** — upload a file to Azure DevOps and get back its attachment URL, for
  embedding inline (e.g. `<img src="...">`) in a work item's rich-text fields or comments.
- **`addWorkItemAttachment`** — upload a file and link it to a work item as a formal attachment
  (`AttachedFile` relation), in addition to returning the URL for inline embedding.
- **`listWorkItemAttachments`** — list the attachments already linked to a work item (id, URL,
  file name, comment) by reading its relations.
- `filePath` parameter on `uploadAttachment` / `addWorkItemAttachment`, letting the server stream
  a file directly from disk instead of requiring the caller to read it, base64-encode it, and
  regenerate that entire string as a tool argument — both slow and token-expensive for anything
  but a trivial file.
- A Jest + ts-jest test suite (none existed before this release) covering all three new tools:
  success paths, validation errors, and edge cases (missing file, oversized/boundary base64,
  default vs. explicit file names).

All three tools route through this server's own authenticated `azure-devops-node-api` connection
(PAT / NTLM / Basic / Entra, cloud or on-premises) — the same connection every other tool in this
project uses — rather than requiring a separate, hand-rolled REST call.

### Changed

- `base64Content` on `uploadAttachment` / `addWorkItemAttachment` is now capped at **1 KB
  decoded** — anything larger is rejected immediately with a clear error pointing at `filePath`,
  instead of silently accepting a payload that could take many minutes to transmit.

### Fixed

- `fs.createReadStream` on a missing `filePath` doesn't throw synchronously — it emits an async
  `'error'` event that, left unhandled, crashes the process instead of failing the call cleanly.
  Now checked up front with a normal thrown error.
- The base64 decoded-size estimate now accounts for `=` padding, so a payload sitting exactly at
  the 1 KB boundary isn't incorrectly rejected.

[Unreleased]: https://github.com/selerix/Selerix-AzureDevOps-MCP/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/selerix/Selerix-AzureDevOps-MCP/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/selerix/Selerix-AzureDevOps-MCP/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/selerix/Selerix-AzureDevOps-MCP/releases/tag/v1.1.0
