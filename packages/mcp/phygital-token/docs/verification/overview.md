# Verification overview

Choose the right possession check for your product surface.

```
Need on-chain state change / CPI?
    │
    YES → transfer (set_linked_wallet)
    │       → beginTransfer → authenticatePasskeyForTransfer → completeTransfer
    │
    │     OR composable verify CPI
    │       → buildMessageHash → authenticatePasskeyForSecp256r1Verify
    │         → buildSecp256r1VerifyInstruction → your program CPIs verify
    │
    NO  → Web2 passkey login (no chain tx)
          → startAuthentication(message, { rpc, allowList? })
          → verifyResponse({ expectedMessage, response })
          → create your normal session (cookie / JWT / …)
```

**Browser taps recover a 16-byte placeholder id via Kit `Rpc`** (on-chain PhygitalToken lookup). `allowList` (Set of base64url compressed public keys) is the fallback that recovers locally when no `rpc` is given, and it always gates: the tapped credential id must be in it. Native readers use `startAuthentication(message, { transceive })` — `rpId`/`origin` are optional (set `origin` if your program checks `expected_origins`).

## Off-chain login

- **`startAuthentication(message, { rpc, allowList? })`** — NFC tap; optional `transceive` for APDU
- **`verifyResponse({ expectedMessage, response })`** — secp256r1 only (no rpId/origin)

See [Verification methods](./methods.md) for the full contract.

## Related

- [Verification methods](./methods.md)
- [Composable verify](./verify-composable.md)
