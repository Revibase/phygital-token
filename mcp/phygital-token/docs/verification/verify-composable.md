# Composable `verify` (TypeScript)

On-chain passkey authentication for custom programs. **Not** the same as off-chain `startAuthentication` + `verifyResponse`.

Do **not** pass a token PDA up front — after the NFC tap, `buildSecp256r1VerifyInstruction` derives it from `response.id` via `findPhygitalTokenPda`.

Your program always CPIs `verify`. The client prepends `secp256r1_verify` and does **not** include a client-side `verify` instruction.

## Session flow

```
buildMessageHash(message)
        ↓
authenticatePasskeyForSecp256r1Verify({ messageHash })
        ↓
buildSecp256r1VerifyInstruction(tap)
        ↓
[secp256r1_verify, your_program_instruction]
```

## Functions

### `buildMessageHash(message)`

SHA-256s `message` to a 32-byte digest. Use this digest as the WebAuthn challenge and as `VerifyCpiBuilder.message_hash`.

### `authenticatePasskeyForSecp256r1Verify({ messageHash, rpId? })`

Uses `messageHash` (32 bytes) directly as the WebAuthn challenge — the same digest your program must pass to `VerifyCpiBuilder.message_hash`. Hash with `buildMessageHash` first. `rpId` defaults to `window.location.hostname`.

### `buildSecp256r1VerifyInstruction(tap)`

Returns `{ secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs }`. Prepend `secp256r1VerifyInstruction`. Pass `phygitalTokenPda` and `secp256r1VerifyArgs` into your instruction. `message_hash`, the instructions sysvar, and optional origin bindings come from your program.

## Client

**Transaction order:**

```
secp256r1_verify → your_program_instruction
```

```ts
const messageHash = buildMessageHash(message);
const tap = await authenticatePasskeyForSecp256r1Verify({ messageHash });
const { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs } =
  await buildSecp256r1VerifyInstruction(tap);

const instructions = [
  secp256r1VerifyInstruction, // immediately before your instruction
  yourProgramInstruction, // use phygitalTokenPda & secp256r1VerifyArgs as inputs when generating your program instruction
];
```

**Your Rust program:** CPI `verify` using `VerifyCpiBuilder` from `phygital-token-client`. The `secp256r1_verify` instruction must appear earlier in the same transaction (verified via instructions sysvar inside `verify`).

## `verify` instruction layout

Accounts: `phygital_token` (writable), `instructions_sysvar`.

Args:

- `secp256r1VerifyArgs: { verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }`
- `messageHash` — 32-byte WebAuthn challenge (`buildMessageHash(message)`)
- `expectedRpId?: string` (`Option<string>`) — when set, `SHA256(rpId)` must equal authenticatorData\[0..32\]
- `expectedOrigins?: string[]` (`Option<string[]>`) — when set, clientDataJSON `origin` must equal one of these values. `None` skips the check.

These bindings are set on **your** CPI (`VerifyCpiBuilder.expected_rp_id` / `.expected_origins`), not on the tap helper. The tap's `rpId` only selects which WebAuthn relying party the browser uses (defaults to hostname). Standalone `getVerifyInstruction` takes the same optional args (`null` / omit encoded as `None`).

## On-chain effects

- Verifies WebAuthn signature against `messageHash`
- Sets `phygital_token.last_sign_count` from the WebAuthn authenticatorData `signCount`
- Does **not** change `phygital_token.owner`
