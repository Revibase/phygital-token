# Verification methods

## Sign in with an accessory

```
Server: const message = crypto.randomUUID()   // store single-use
Client: startAuthentication(message, { rpc, allowList? })
Server: verifyResponse({ expectedMessage: message, response })
      → findPhygitalTokenPda(secp256r1PublicKey) → your session
```

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findPhygitalTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";
```

```
[ Sign in with passkey ]     ← keep as-is
[ Sign in with accessory ]   ← startAuthentication + verifyResponse → same session
```

No `generateAuthenticationOptions`. No rpId/origin binding on verify.

| | |
|--|--|
| `startAuthentication(message, { rpc, allowList? })` | browser tap + placeholder recovery |
| `startAuthentication(message, { transceive })` | native APDU |
| `verifyResponse({ expectedMessage, response })` | secp256r1 check; returns `secp256r1PublicKey` |

## When to use what

| Need | Use |
|------|-----|
| UI login / vault gate | `startAuthentication` + `verifyResponse` → your session |
| Load on-chain state after a tap | verify → `findPhygitalTokenPda` + `fetchPhygitalToken` |
| Set linked wallet | `beginTransfer` → `completeTransfer` |
| On-chain possession proof / CPI | `buildMessageHash` → `authenticatePasskeyForSecp256r1Verify` → `buildSecp256r1VerifyInstruction` |
| Native / kiosk IsoDep | `startAuthentication(message, { transceive })` |
