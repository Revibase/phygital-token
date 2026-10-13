# System architecture and trust boundaries

```
 ┌──────────────┐  NFC / WebAuthn   ┌───────────────────────────┐     ┌───────────────────────────┐
 │  Accessory   │ ◀───────────────▶ │ Phone browser (tap page)  │     │ Wallet app browser, or a  │
 │ (P-256 chip) │   assertion over  │ portal origin             │     │ computer (the finisher)   │
 └──────────────┘   a challenge     └─────────────┬─────────────┘     └─────────────┬─────────────┘
                                   HTTPS (same    │ cookies, JSON     handoff /      │ cookies, JSON
                                   origin)        │                   pairing link   │
                                    ┌─────────────▼─────────────────────────────────▼─────────────┐
                                    │ App server (Cloudflare Worker + D1)                          │
                                    │  tap URL verification · sessions · link ceremonies           │
                                    └─────────────┬────────────────────────────────────────────────┘
                                                  │ RPC (the finisher's wallet signs and sends)
                                    ┌─────────────▼──────────────────────────┐
                                    │ Solana: secp256r1 precompile + program │
                                    │ (trusts only signatures it verifies)   │
                                    └────────────────────────────────────────┘
```

## Components

| Component | Holds | Trusts | Documented in |
|-----------|-------|--------|---------------|
| Accessory | its P-256 private key | nothing | — |
| Program | token and config accounts | the precompile's signature check, transaction signers, its admin/issuer/minter | [program threat model](../program/THREAT_MODEL.md) |
| App page | session cookies (HttpOnly) | the server's responses | [app architecture](../../app/ARCHITECTURE.md) |
| App server | `SESSION_SECRET`, D1 | WebAuthn assertions it verifies, signatures it verifies, the chain via RPC | [app architecture](../../app/ARCHITECTURE.md) |
| SDK | nothing | the program's encodings (shared test vectors) | [SDK README](../../packages/js/phygital-token/README.md) |

## Boundaries and what crosses them

1. **Accessory → browser.** An assertion over a 32-byte challenge: `set_owner`
   for one token and recent slot, or an integrator's login message. The browser
   binds the page origin into `clientDataJSON`; a native client can write any
   origin. The `set_owner` challenge does not name the recipient.
2. **Phone browser → app server → finisher.** The server verifies the tap
   (origin, rpId, signature) and stores it on a short-lived link intent. Only
   the finisher that claimed the single-use handoff or pairing capability (sent
   in a URL fragment, stored hashed) can read it and set the recipient.
3. **Finisher → program.** The finisher's wallet signs a transaction with a
   precompile instruction carrying the assertion; the app validates the exact
   bytes before and after the wallet signs. The program re-derives the
   challenge and checks the assertion was verified over bytes in the precompile
   instruction itself (INVARIANTS T1–T5).
4. **Browser → app server.** Same-origin JSON with HMAC-signed cookies. Bodies
   are size-capped.

## Data the server stores

D1 tables (see [app/migrations/README.md](../../app/migrations/README.md)):
single-use challenges, tap counters, the identifier→token cache and
short-lived link intents (with the tap's assertion until the link ends). No
private keys.
