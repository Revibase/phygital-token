# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a token with a live NFC tap, or prove possession on-chain so another program can CPI `verify`.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

`@solana/kit` is a peer. On-chain programs use the Rust crate `phygital-token-client`.

## Off-chain authentication

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findPhygitalTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");

// Server: issue a short-lived challenge
const message = crypto.randomUUID();

// Client: native NFC modal (rpc required for placeholder recovery)
const response = await startAuthentication(message, rpc);

// Server: check the signature (no RPC)
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  const { data } = await fetchPhygitalToken(
    rpc,
    await findPhygitalTokenPda(secp256r1PublicKey),
  );
  // Proceed with custom logic using data.owner or data.mint
}
```

Native / kiosk readers: pass `transceive` in the third argument — browser WebAuthn (and `rpc`) is skipped.

```ts
const response = await startAuthentication(message, rpc, { transceive });
```

## On-chain `verify` (CPI)

Use this when **your program** needs a possession proof. Your program CPIs `verify` with `VerifyCpiBuilder`.

The tap uses your `messageHash` (32 bytes) as the WebAuthn challenge. Hash with `buildMessageHash` first, and pass the same digest to `VerifyCpiBuilder.message_hash`. Fold in any freshness or domain separation before hashing.

### Client (TypeScript)

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  buildMessageHash,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
const messageHash = buildMessageHash(message);
const tap = await authenticatePasskeyForSecp256r1Verify({
  rpc,
  messageHash,
});
const { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs } =
  buildSecp256r1VerifyInstruction(tap);

const instructions = [
  secp256r1VerifyInstruction, // immediately before your instruction
  yourProgramInstruction, // use phygitalTokenPda & secp256r1VerifyArgs as inputs
];
```

### Program (Rust)

```rust
use phygital_token_client::generated::instructions::VerifyCpiBuilder;

VerifyCpiBuilder::new(phygital_token_program)
    .phygital_token(phygital_token) // phygitalTokenPda from the tap
    .instructions_sysvar(instructions_sysvar) // your accounts
    .secp256r1_verify_args(secp256r1_verify_args) // from the tap
    .message_hash(message_hash) // same digest as buildMessageHash(message)
    // optional WebAuthn bindings (omit to skip):
    .expected_rp_id("app.example".into())
    .expected_origins(vec![
        "https://app.example".into(),
        "http://localhost:3000".into(),
    ])
    .invoke()?;
```

Crate: `phygital-token-client`.

`expected_rp_id` / `expected_origins` are set on **your CPI**, not on the TypeScript tap helper. The tap's `rpId` only selects which WebAuthn relying party the browser uses. When `expected_origins` is set, `clientDataJSON.origin` must match one listed origin.

## License

MIT. See [LICENSE](./LICENSE).
