# System architecture and trust boundaries

```
 ┌──────────────┐  NFC / WebAuthn   ┌───────────────────────────┐
 │  Accessory   │ ◀───────────────▶ │ Browser (portal origin)   │
 │ (P-256 chip) │   assertion over  │ tap, claim, shortcuts     │
 └──────────────┘   a challenge     └─────────────┬─────────────┘
                                                  │ same-origin HTTPS
                                    ┌─────────────▼─────────────────────┐
                                    │ App server (Worker + D1)          │
                                    │ tap URLs · sessions · challenges  │
                                    └─────────────┬─────────────────────┘
                                                  │ the browser's wallet signs
                                    ┌─────────────▼──────────────────────────┐
                                    │ Solana: secp256r1 precompile + program │
                                    └────────────────────────────────────────┘
```

An embed shortcut is an iframe on this page. It can ask the page to connect and sign. The connected wallet still signs. The iframe does not receive keys or cookies.

## Components

| Component | Holds | Trusts | Documented in |
|-----------|-------|--------|---------------|
| Accessory | its P-256 private key | nothing | — |
| Program | token and config accounts | the precompile, transaction signers, its admin, issuer, and minter | [program threat model](../program/THREAT_MODEL.md) |
| App page | session cookies (HttpOnly) | the server's responses | [app architecture](../../app/ARCHITECTURE.md) |
| App server | `SESSION_SECRET`, D1 | assertions it verifies, the chain via RPC | [app architecture](../../app/ARCHITECTURE.md) |
| SDK | nothing | the program's encodings | [SDK README](../../packages/js/phygital-token/README.md) |

## What crosses a boundary

1. **Accessory → browser.** An assertion over a 32-byte challenge: `set_owner` for one token and a recent slot, or an integrator's login message. The browser binds the page origin into `clientDataJSON`. A native client can write any origin. The `set_owner` challenge does not name the recipient.
2. **Browser → program.** The connected wallet signs a transaction that carries the assertion in a precompile instruction. The app checks the bytes before and after signing. The program re-derives the challenge and checks the precompile instruction itself (INVARIANTS T1–T5). The assertion is not sent to the app server.
3. **Browser → app server.** Same-origin JSON with HMAC-signed cookies. Bodies are size-capped.
4. **Iframe → page.** Public keys and the bytes a dApp asks to sign, from an origin the page chose to frame. No cookies or key material.

## What the server stores

D1 holds single-use challenges, tap counters, and the identifier-to-token cache. See [app/migrations/README.md](../../app/migrations/README.md). No private keys and no tap assertions.
