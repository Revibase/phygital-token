# System architecture and trust boundaries

```
 ┌──────────────┐  NFC / WebAuthn   ┌──────────────────────────────┐
 │  Accessory   │ ◀───────────────▶ │ Browser                      │
 │ (P-256 chip) │   assertion over  │  ┌────────────────────────┐  │  postMessage   ┌──────────────────┐
 └──────────────┘   a challenge     │  │ App page (portal)      │◀─┼───────────────▶│ Signer iframe    │
                                    │  │ untrusted by signer    │  │  (origin-      │ (own origin;     │
                                    │  └─────────┬──────────────┘  │   pinned)      │  holds keys)     │
                                    └────────────┼─────────────────┘                └────────┬─────────┘
                                   HTTPS (same   │ cookies,                                  │ HTTPS,
                                   origin)       │ JSON                                      │ no cookies
                                    ┌────────────▼─────────────────────────────────────────▼────────┐
                                    │ App server (Cloudflare Worker + D1)                            │
                                    │  tap URL verification · sessions · signer backup API · fee      │
                                    │  service (pool keys sign only checked transactions)             │
                                    └────────────┬────────────────────────────────────────────────────┘
                                                 │ RPC
                                    ┌────────────▼───────────────────────────┐
                                    │ Solana: secp256r1 precompile + program │
                                    │ (trusts only signatures it verifies)   │
                                    └────────────────────────────────────────┘
```

## Components

| Component | Holds | Trusts | Documented in |
|-----------|-------|--------|---------------|
| Accessory | its P-256 private key | nothing | — |
| Program | token, policy and config accounts; signs for wallet PDAs | the precompile's signature check, transaction signers, its admin/issuer/minter | [program threat model](../program/THREAT_MODEL.md) |
| Signer iframe | the passkey wallet's ed25519 seed (only in memory, wrapped by the passkey's PRF at rest) | its own origin and the passkey; **not** the parent page | [signer threat model](../../secure-signer/THREAT_MODEL.md) |
| App page | session cookies (HttpOnly) | the server's responses | [app architecture](../../app/ARCHITECTURE.md) |
| App server | `SESSION_SECRET`, fee-payer pool keys, D1 | WebAuthn assertions it verifies, signatures it verifies, the chain via RPC | [app architecture](../../app/ARCHITECTURE.md) |
| SDK | nothing | the program's encodings (shared test vectors) | [SDK README](../../packages/js/phygital-token/README.md) |

## Boundaries and what crosses them

1. **Accessory → browser.** An assertion over a 32-byte challenge. The challenge
   says what is being authorized (`set_owner` for a named recipient, an exact
   execute, or an integrator's message). The browser binds the page origin into
   `clientDataJSON`; a native client can write any origin.
2. **Browser → program.** A transaction with a precompile instruction carrying
   the assertion. The program re-derives the challenge and checks the assertion
   was verified over bytes in the precompile instruction itself (INVARIANTS T1–T5).
3. **App page ↔ signer iframe.** postMessage pinned to one parent origin and
   `window.parent`, schema-validated, replay-checked. The signer decodes every
   transaction itself and shows its own confirm screen; it never trusts the
   page's description.
4. **Browser → app server.** Same-origin JSON with HMAC-signed cookies; the
   signer's backup calls come from the signer origin and authenticate each call
   (WebAuthn, ed25519). Bodies are size-capped.
5. **App server → chain.** The fee service co-signs only transactions it has
   decoded and simulated: one real phygital-token action, within compute and
   priority caps, losing the pool no more than its fee.

## Data the server stores

D1 tables (see [app/migrations/README.md](../../app/migrations/README.md)):
single-use challenges, tap counters, the identifier→token cache, encrypted
signer blobs keyed by passkey public key, and the fee ledger. No private keys.
