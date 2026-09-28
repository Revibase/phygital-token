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
          → startAuthentication(message, { rpc })
          → verifyResponse({ expectedMessage, response })
          → create your normal session (cookie / JWT / …)
```

**Browser placeholder recovery requires Kit `Rpc`.** Native readers use `startAuthentication(message, { transceive })` — `rpId`/`origin` not required.

## Off-chain login

- **`startAuthentication(message, { rpc? })`** — NFC tap; optional `transceive` for APDU
- **`verifyResponse({ expectedMessage, response })`** — secp256r1 only (no rpId/origin)

See [Verification methods](./methods.md) for the full contract.

## Related

- [Verification methods](./methods.md)
- [Composable verify](./verify-composable.md)
