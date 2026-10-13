# secure-signer

The **Revibase passkey wallet**: a non-custodial Solana signing iframe served
from its own origin (`signer.revibase.com`) and embedded by the Revibase app
(`portal.revibase.com`). The app registers it with Wallet Standard as
“Revibase Passkey”, so it is listed next to detected wallets.

An Ed25519 wallet key is generated inside this origin and wrapped by a key
derived from the passkey's **WebAuthn PRF** output (HKDF-SHA256 → AES-256-GCM).
The ciphertext (an RSS1 blob) lives in a CHIPS partitioned, HttpOnly cookie set
by this origin's `/vault` endpoint (Safari clears a framed origin's
localStorage and IndexedDB, but keeps partitioned cookies), with an
encrypted backup on the app worker for restoring on a new phone. The parent
app is treated as **potentially XSS-compromised**; the signer is the trust
boundary.

> This is security infrastructure. It is **not** "XSS-proof", "unhackable", or
> "100% secure." See [THREAT_MODEL.md](./THREAT_MODEL.md) for exactly what it does
> and does not protect against.

## Layout

```
secure-signer/
  src/
    shared/               # wire contract shared with the app (protocol, blob, challenges, API, RP ID)
    constants.ts          # parent origin, caps, fixed KDF params
    encoding.ts           # bounded base64/base64url + constant-time compare
    messaging/            # the trust boundary with the parent page
      protocol.ts         #   postMessage schema validation
      state.ts            #   state machine, replay/freshness, digest auth
    keys/                 # key material; nothing here leaves the signer origin
      webauthn.ts         #   BrowserPrfProvider (PRF output from the passkey)
      wallet-service.ts   #   PRF -> HKDF -> AES-GCM pipeline
      wallet-format.ts    #   deterministic binary blob + AES-GCM AAD
      crypto.ts           #   WebCrypto HKDF/AES-GCM + @solana/kit Ed25519
    storage/              # where ciphertext lives
      blob-store.ts       #   local ciphertext via /vault
      vault.ts            #   /vault: partitioned HttpOnly cookie (Worker + dev server)
      api-backup.ts       #   app worker backup client (/api/signer/*)
    tx/                   # what is being signed
      decode.ts           #   @solana/kit legacy/v0/v1 decode + decompile
      policy.ts           #   program allowlist + signer binding
      parser.ts           #   phygital-token instruction decode
      clear-sign.ts       #   human-readable summaries
    ui/ui.ts              # trusted confirm/create/unlock/export screens
    dispatcher.ts         # message gate (origin, source, schema, replay) and routing
    deps.ts               # injected side effects (UI, PRF, backup API, storage, clock)
    flows/                # one module per request: auth (create/unlock/restore),
                          #   sign-transaction, sign-message, export-key; shared
                          #   context and restore helpers
    worker.ts             # signer Worker: /vault, then static assets
    main.ts               # wiring
  testing/                # test-only harness and fixtures (never bundled)
  deploy/_headers
  THREAT_MODEL.md
```

## Develop

```bash
pnpm --filter secure-signer test        # unit/adversarial tests (headless)
pnpm --filter secure-signer typecheck
pnpm --filter secure-signer build       # tsc + vite build + CSP inline guard
pnpm --filter secure-signer dev         # localhost:5174, framed by the app on :5173
```

WebAuthn/PRF flows need a real authenticator with PRF support; the crypto
pipeline and every flow are covered headlessly with a virtual authenticator.

## What it signs

Legacy, v0 without address lookup tables, and v1 transactions, decoded with
`@solana/kit`. Every top-level instruction must be one the app asks an owner to
sign — phygital-token `set_owner` (with its secp256r1 verify), `remove_owner`,
`execute_with_owner`, `update_policy`, `close_policy`, ATA `createIdempotent`,
or ComputeBudget — and every signing role must be this wallet. The inner
instructions of `execute_with_owner` are decoded and **displayed**, not blocked:
the owner may do anything with its accessory wallet, and anything the signer
can't decode is shown as critical.

`SIGN_MESSAGE` signs only the app's sign-in message: its first line must name
the parent site and its second line must be this wallet's address.

## postMessage API

Request → result: `AUTH_START` → `AUTH_COMPLETE`, `SIGN_TRANSACTION`,
`SIGN_MESSAGE`, `EXPORT_PRIVATE_KEY`.

**Create** (`authMode: "create"`): the app registers the passkey top-level
(Safari can't create one in a cross-origin frame) and sends `credentialId` +
`webauthnAttestationObject`. The signer mints a backup challenge, enrolls
(PRF), PUTs the blob and returns `{ publicKey, created: true }`.

**Unlock** (`authMode: "unlock"`): with local ciphertext, PRF + PUT refresh.
Otherwise a discoverable WebAuthn get + restore from the backup API; an unknown
passkey returns `NOT_FOUND`. Ciphertext never enters the parent.

All requests carry `{ protocolVersion: 1, requestId, timestamp }`; transactions
and messages are base64. Errors are `{ type: "ERROR", requestId, code }`. The
signer posts `{ type: "SIGNER_READY" }` on load and `SIGNER_HEIGHT` for sizing.

## Deployment

```bash
pnpm --filter secure-signer deploy      # build, copy _headers, wrangler deploy
```

Serve `dist/` from a **separate origin** with the headers in `deploy/` (strict
CSP with `connect-src` limited to the app's backup API, `frame-ancestors <app>`,
`Permissions-Policy: publickey-credentials-get=(self), clipboard-write=(self)`,
HSTS, no-store index). Do **not** add `X-Frame-Options` (breaks embedding) or
COEP. The app delegates `publickey-credentials-get` and `clipboard-write` to the
signer origin via `Permissions-Policy` and the iframe `allow=` attribute, and
lists it in `frame-src`.

## Security

Guarantees and the tests that hold them: [SECURITY.md](SECURITY.md).
