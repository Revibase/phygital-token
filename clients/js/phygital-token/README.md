# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a phygital asset with a live NFC tap using challenge–response.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Authenticate with NFC device

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

const message = crypto.randomUUID();

// Trigger native NFC modal
const response = await startAuthentication(message);

const { isVerified, asset } = await verifyResponse({
  rpc,
  expectedMessage: message,
  response,
});

if (isVerified) {
  // Continue with asset.owner (user's wallet address)
}
```

`startAuthentication` prompts an NFC tap. `verifyResponse` checks the signature and returns `{ isVerified, asset }`.

## License

ISC
