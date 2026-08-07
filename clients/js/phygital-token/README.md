# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a phygital asset with a live NFC tap using challenge–response.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Authenticate with NFC device

The custom authenticator uses the compressed secp256r1 **public key** as the WebAuthn `credential.id` and `user.id`. After a tap, `response.id` is that public key.

The on-chain asset PDA is seeded by a separate chip **`identifier`**, which is distinct from the passkey public key. Use `findAssetPda(identifier)` when you know the identifier, or `fetchAssetsByPublicKey` to look up by passkey after a tap.

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  fetchAssetsByPublicKey,
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
  const [asset] = await fetchAssetsByPublicKey(rpc, secp256r1PublicKey);
  // Continue with asset.owner / asset.identifier / asset.publicKey
}
```

`startAuthentication` prompts an NFC tap. `verifyResponse` checks the signature (no RPC) and returns `{ isVerified, secp256r1PublicKey }`.

## License

ISC
