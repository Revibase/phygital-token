# phygital-token-sdk

TypeScript client for the Phygital Token Solana program. Authenticate a token with a live NFC tap, or prove possession on-chain so another program can CPI `verify`.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

`@solana/kit` is a peer. On-chain programs use the Rust crate `phygital-token-client`.

## Off-chain authentication

The authenticator uses the compressed secp256r1 **public key** as the WebAuthn `credential.id`.

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findPhygitalTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";

// Server: issue a short-lived challenge
const message = crypto.randomUUID();

// Client: native NFC modal
const response = await startAuthentication(message);

// Server: check the signature (no RPC)
const { isVerified, secp256r1PublicKey } = verifyResponse({
  expectedMessage: message,
  response,
});

if (isVerified) {
  const rpc = createSolanaRpc("https://api.mainnet-beta.solana.com");
  const { data } = await fetchPhygitalToken(
    rpc,
    await findPhygitalTokenPda(secp256r1PublicKey),
  );
  // Proceed with custom logic using data.owner or data.mint
}
```

## On-chain `verify` (CPI)

Use this when **your program** needs a possession proof. Your program CPIs `verify` with `VerifyCpiBuilder`.

The tap uses your `messageHash` (32 bytes) as the WebAuthn challenge. Hash with `buildMessageHash` first, and pass the same digest to `VerifyCpiBuilder.message_hash`. Fold in any freshness or domain separation before hashing.

### Client (TypeScript)

```ts
import {
  buildMessageHash,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "phygital-token-sdk";

const messageHash = buildMessageHash(message);
const tap = await authenticatePasskeyForSecp256r1Verify({
  messageHash,
});
const { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs } =
  await buildSecp256r1VerifyInstruction(tap);

const instructions = [
  secp256r1VerifyInstruction, // immediately before your instruction
  yourProgramInstruction, // use phygitalTokenPda & secp256r1VerifyArgs as inputs when generating your program instruction
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
    .invoke()?;
```

Crate: `phygital-token-client`.

## License

ISC
