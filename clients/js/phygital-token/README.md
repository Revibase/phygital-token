# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a phygital asset with a live NFC tap using challenge–response.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Authenticate with NFC device

The custom authenticator uses the compressed secp256r1 **public key** as the WebAuthn `credential.id` and `user.id`. After a tap, `response.id` is that public key — there is no separate on-chain credential id.

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  parseSecp256r1Pubkey,
  findAssetPda,
  fetchAsset,
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
  const asset = await fetchAsset(
    rpc,
    await findAssetPda(parseSecp256r1Pubkey(secp256r1PublicKey)),
  );
  // Continue with asset.data.owner (user's wallet address)
}
```

`startAuthentication` prompts an NFC tap. `verifyResponse` checks the signature (no RPC) and returns `{ isVerified, secp256r1PublicKey }`.

## License

ISC
