# Verification methods

## Sign in with an accessory

```
Server: const message = crypto.randomUUID()   // store single-use
Client: startAuthentication(message, { rpc, allowList? })
Server: await verifyResponse({ expectedMessage: message, expectedOrigin: "https://app.example.com", response })
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

No `generateAuthenticationOptions`.

| | |
|--|--|
| `startAuthentication(message, { rpc, allowList? })` | browser tap + placeholder recovery |
| `verifyResponse({ expectedMessage, expectedOrigin, response })` | asynchronous secp256r1 and origin check; returns `{ isVerified, secp256r1PublicKey }` |

## When to use what

| Need | Use |
|------|-----|
| UI login / vault gate | `startAuthentication` + `verifyResponse` → your session |
| Load on-chain state after a tap | `verifyResponse` → `findPhygitalTokenPda` + `fetchPhygitalToken` |
| Set owner | `beginTransfer` → `completeTransfer` |

Check `isVerified` before issuing a session; freshness, single-use challenge consumption and session policy remain your responsibility.
