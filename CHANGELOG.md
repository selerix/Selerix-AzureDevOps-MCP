# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project
follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/selerix/Selerix-AzureDevOps-MCP/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/selerix/Selerix-AzureDevOps-MCP/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/selerix/Selerix-AzureDevOps-MCP/releases/tag/v1.1.0
