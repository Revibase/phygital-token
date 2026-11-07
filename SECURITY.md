# Security

Report vulnerabilities privately with GitHub's [Report a vulnerability](https://github.com/Revibase/phygital-token/security/advisories/new) form. Don't open a public issue.

Include the component, the commit, the impact and steps to reproduce it. We aim to acknowledge reports within three business days and agree on a disclosure date once a fix is ready.

**In scope:** the on-chain program (highest priority), the `app` server routes (sessions, tap checks, claiming) and `phygital-token-sdk`. Only the latest deployed program and the latest published packages get fixes.

**Out of scope:** denial of service by volume alone, findings that need a compromised device, and dependency issues with no impact here.

## Verify the deployed program

```bash
cargo install solana-verify --version 0.5.2 --locked
solana-verify build --library-name phygital_token
solana-verify get-executable-hash target/deploy/phygital_token.so
solana-verify get-program-hash -u mainnet-beta DuPpckdjjgVAnYok2aTMAt264ZPBXqq3JSazJjCUzTJQ
```

The two hashes must match. `.github/workflows/verify.yml` runs the same build on `program-v*` tags.
