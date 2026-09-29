# phygital-token-sdk

TypeScript client for the Phygital Token Solana program.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Sign in with an accessory

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findPhygitalTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.devnet.solana.com");

// Server: issue a short-lived challenge
const message = crypto.randomUUID();

// Client: NFC tap. `rpc`
const response = await startAuthentication(message, { rpc });
// Native / kiosk: startAuthentication(message, { transceive })

// Server: check the signature
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});
if (!isVerified) throw new Error("bad tap");

const token = await fetchPhygitalToken(
  rpc,
  await findPhygitalTokenPda(secp256r1PublicKey),
);
// token.data.linkedWallet
```

## On-chain `verify` (CPI)

```ts
import {
  buildMessageHash,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "phygital-token-sdk";

const messageHash = buildMessageHash(message);
const tap = await authenticatePasskeyForSecp256r1Verify({ rpc, messageHash });
const { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs } =
  await buildSecp256r1VerifyInstruction(tap);
```
