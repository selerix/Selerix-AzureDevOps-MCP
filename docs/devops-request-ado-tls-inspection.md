# DevOps request: let Node trust the ADO "test results" and "release" hosts through Zscaler

**Requested by:** Ivan Tsitovich (QA automation)
**Date:** 2026-10-15
**Affects:** Selerix fork of the Azure DevOps MCP server (`@selerix/azuredevops-mcp-server`), run locally with Node 20
**Urgency:** Low. One test-execution tool cannot work until this is fixed; nothing else is blocked.

## What is wrong

Nothing needs to change inside Azure DevOps (the organization, project, permissions or PAT). The problem is on the network path to two Azure DevOps service hosts.

Zscaler performs TLS inspection on `vstmr.dev.azure.com` and `vsrm.dev.azure.com`. It replaces Microsoft's certificate with one signed by the Zscaler Root CA. Node.js does not use the Windows certificate store, so it does not trust that root and refuses the connection:

```
unable to get local issuer certificate
```

`dev.azure.com` itself is not inspected (it presents Microsoft's own certificate chain), so most Azure DevOps traffic works. Only calls that go to the two hosts below fail.

### Evidence (checked 2026-10-15 from a developer machine on the corporate network)

| Host | What it serves | Certificate issuer seen | Trusted by Node 20 |
|---|---|---|---|
| `dev.azure.com` | Core REST APIs (work items, test plans, builds) | Microsoft TLS G2 RSA CA, chain to DigiCert Global Root G2 | Yes |
| `vstmr.dev.azure.com` | Test Results service | Zscaler Intermediate Root CA, chain to Zscaler Root CA | **No** (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`) |
| `vsrm.dev.azure.com` | Release Management service | Zscaler Intermediate Root CA, chain to Zscaler Root CA | **No** (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`) |

The Azure DevOps web UI is not affected, because browsers use the Windows certificate store, which already contains the Zscaler Root CA.

## What stops working

| Tool | Host used | Status |
|---|---|---|
| `deleteTestRunAttachment` | `vstmr.dev.azure.com` | Fails with the error above (confirmed live). Azure DevOps only allows this delete through the Test Results service. |
| `listReleaseDefinitions`, `getReleaseDefinitionDetails` | `vsrm.dev.azure.com` | Expected to fail the same way (not yet run live). |
| `startTestRun` with `testType: "automated"` / `runner: "releaseStage"` | `vsrm.dev.azure.com` | Expected to fail the same way (not yet run live). |

Everything else in the test-execution toolset already works, because it uses `dev.azure.com`.

## Requested change (choose one)

### Option A (preferred): bypass TLS inspection for the two Azure DevOps service hosts

In the Zscaler SSL inspection policy, add a "Do not inspect" rule for:

- `vstmr.dev.azure.com`
- `vsrm.dev.azure.com`

This matches how `dev.azure.com` is already handled, so no client needs any change.

Please also review the other Azure DevOps service hosts under `*.dev.azure.com`. We only checked the three above, and other services (for example `vssps.dev.azure.com`, `feeds.dev.azure.com`, `pkgs.dev.azure.com`) may be inspected too and would fail the same way for any tool that uses them. If the whole `*.dev.azure.com` wildcard can be bypassed, that avoids this recurring one host at a time.

### Option B: make Node trust the Zscaler Root CA on developer machines

If inspection of these hosts has to stay on, Node needs the Zscaler Root CA, because it ignores the Windows store. Distribute the root certificate (PEM format) to developer machines and set the environment variable below for the MCP server process, or machine-wide:

```
NODE_EXTRA_CA_CERTS=<path to the Zscaler Root CA .pem file>
```

This is a trust-store change on every developer machine, so Option A is simpler and safer if policy allows it.

## How to verify the change

Run this on a developer machine (Node 20). It prints whether Node trusts each host and who issued the certificate:

```
node -e "const tls=require('tls');(async()=>{for(const host of ['dev.azure.com','vstmr.dev.azure.com','vsrm.dev.azure.com']){await new Promise(res=>{const s=tls.connect({host,port:443,servername:host,rejectUnauthorized:false},()=>{const c=s.getPeerCertificate(true);console.log(host,'trusted='+s.authorized,s.authorizationError||'','issuer='+(c.issuer&&c.issuer.CN));s.end();res();});s.on('error',e=>{console.log(host,'ERR',e.code||e.message);res();});});}})();"
```

**Expected after the fix:** all three hosts print `trusted=true` and a Microsoft issuer (Option A), or `trusted=true` with the Zscaler issuer when `NODE_EXTRA_CA_CERTS` is set (Option B).

The MCP server's delete tool can then be retested with no code change.

## Notes

- No credentials, tokens or secrets are involved or need to be shared for this request.
- The server only makes outbound HTTPS requests to Azure DevOps, using the user's own PAT.
- This affects every developer who runs the MCP server on the corporate network, not only the requester.
