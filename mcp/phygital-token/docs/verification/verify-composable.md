# Composable `verify` (TypeScript)

On-chain passkey authentication for custom programs. **Not** the same as off-chain `startAuthentication` + `verifyResponse`.

Do **not** pass a token PDA up front — after the NFC tap, `buildVerifyArgs` / `completeVerify` derive it from `response.id` via `findTokenPda`.

## Session flow

```
beginVerify({ messageHash })
        ↓
authenticatePasskeyForVerify(session)   // WebAuthn NFC tap
        ↓
buildVerifyArgs(response)               // or completeVerify(...)
        ↓
assemble transaction (Pattern A or B below)
```

## Functions

### `beginVerify({ messageHash: Uint8Array })`

Uses `messageHash` directly as the WebAuthn challenge (32 bytes). Callers that need slot freshness or domain separation must fold that into `messageHash` before calling.

### `buildVerifyArgs(response)`

Derives `tokenPda` from `response.id` (passkey). Returns `secp256r1Verify`, `signedMessageIndex`, `clientDataJson`, `tokenPda`.

### `completeVerify(session, response)`

Returns `[secp256r1Verify, verifyInstruction]`.

## Pattern A — Client posts `verify`, program inspects

**Client transaction order:**

```
secp256r1_verify → verify → your_program_ix
```

```ts
const session = await beginVerify({ messageHash });
const response = await authenticatePasskeyForVerify(session);

const [secp256r1Verify, verifyIx] = await completeVerify(
  session,
  response,
);

const myIx = buildMyProgramInstruction(/* binds same messageHash */);

await sendTransaction([secp256r1Verify, verifyIx, myIx], { feePayer });
```

**Your Rust program:** Scan `instructions_sysvar` for the `verify` instruction that ran earlier in this transaction. Decode and verify `message_hash` matches your canonical payload.

## Pattern B — Client posts `secp256r1_verify`, program CPIs `verify`

**Client transaction order:**

```
secp256r1_verify → your_program_ix
```

```ts
const session = await beginVerify({ messageHash });
const response = await authenticatePasskeyForVerify(session);

const { secp256r1Verify, signedMessageIndex, clientDataJson, tokenPda } =
  await buildVerifyArgs(response);

// Pass verify args to your program via instruction data
const myIx = buildMyProgramInstruction({
  token: tokenPda,
  secp256r1VerifyArgs: {
    verifyArgsRelativeIndex: -1,
    signedMessageIndex,
    clientDataJson,
  },
  messageHash: session.messageHash,
});

await sendTransaction([secp256r1Verify, myIx], { feePayer });
```

**Your Rust program:** CPI `verify` using `VerifyCpiBuilder` from `phygital-token-client`. The `secp256r1_verify` instruction must appear earlier in the same transaction (verified via instructions sysvar inside `verify`).

## `verify` instruction layout

Accounts: `token` (writable), `instructions_sysvar`.

Args:

- `secp256r1VerifyArgs: { verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }`
- `messageHash` — 32-byte WebAuthn challenge
- `expectedRpId?: string` — when set, `SHA256(rpId)` must equal authenticatorData\[0..32\]
- `expectedOrigin?: string` — when set, clientDataJSON `origin` must equal this value

```ts
const session = await beginVerify({
  messageHash,
  expectedRpId: "example.com",
  expectedOrigin: "https://example.com",
});
```

## On-chain effects

- Verifies WebAuthn signature against `messageHash`
- Sets `token.last_sign_count` from the WebAuthn authenticatorData `signCount`
- Emits `VerifyEvent`
- Does **not** change `token.owner`
