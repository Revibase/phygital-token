# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
[**Report a vulnerability**](https://github.com/Revibase/phygital-token/security/advisories/new).
Do not open a public issue.

Include the affected component and commit, a description of the impact, and a
proof of concept or reproduction steps if you have one. We aim to acknowledge
reports within three business days and to agree on a disclosure date with you
once a fix is ready.

## Scope

| Component | Path | Notes |
|-----------|------|-------|
| On-chain program | [`programs/phygital-token`](programs/phygital-token) | Highest priority. Program id `DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ`. |
| Web app and its server routes | [`app`](app) | Sessions, tap verification, and claiming. See [ARCHITECTURE.md](app/ARCHITECTURE.md). |
| TypeScript SDK | [`packages/js/phygital-token`](packages/js/phygital-token) | Transaction building, passkey verification helpers. |
| Rust CPI client | [`packages/rust/phygital-token`](packages/rust/phygital-token) | Generated from the IDL. |
| MCP server | [`packages/mcp/phygital-token`](packages/mcp/phygital-token) | Read-only documentation and instruction planning. |

Out of scope: denial of service through volume alone (rate limiting is handled
at the edge), findings that require a compromised device or authenticator,
and issues in third-party dependencies without a demonstrated impact here.

## Supported versions

Only the latest deployed program and the latest published package versions
receive security fixes.

## Verifying the deployed program

The program is built reproducibly with `solana-verify`; see
[docs/audit/BUILD.md](docs/audit/BUILD.md) for how to compare a local build with
the deployed bytecode.
