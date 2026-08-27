# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a phygital token with a live NFC tap using challenge–response.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Authenticate with NFC device

The custom authenticator uses the compressed secp256r1 **public key** as the WebAuthn `credential.id` and `user.id`. After a tap, `response.id` is that public key — and the on-chain token PDA is seeded by that same public key. A separate chip `identifier` is stored on the token for binding.

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

const message = crypto.randomUUID();

// Trigger native NFC modal
const response = await startAuthentication(message);

const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  const token = await fetchPhygitalToken(
    rpc,
    await findTokenPda(secp256r1PublicKey),
  );
  // Continue with token.data.owner
}
```

`startAuthentication` prompts an NFC tap. `verifyResponse` checks the signature (no RPC) and returns `{ isVerified, secp256r1PublicKey }`.

## License

ISC
