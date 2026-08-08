# Composable `verify_asset` (TypeScript)

On-chain passkey authentication for custom programs. **Not** the same as off-chain `startAuthentication` + `verifyResponse`.

Do **not** pass an asset PDA up front — after the NFC tap, `buildVerifyAssetArgs` / `completeVerifyAsset` derive it from `response.id` via `findAssetPda`.

## Session flow

```
beginVerifyAsset({ messageHash })
        ↓
authenticatePasskeyForVerifyAsset(session)   // WebAuthn NFC tap
        ↓
buildVerifyAssetArgs(response)               // or completeVerifyAsset(...)
        ↓
assemble transaction (Pattern A or B below)
```

## Functions

### `beginVerifyAsset({ messageHash: Uint8Array })`

Uses `messageHash` directly as the WebAuthn challenge (32 bytes). Callers that need slot freshness or domain separation must fold that into `messageHash` before calling.

### `buildVerifyAssetArgs(response)`

Derives `assetPda` from `response.id` (passkey). Returns `secp256r1Verify`, `signedMessageIndex`, `clientDataJson`, `assetPda`.

### `completeVerifyAsset(session, response)`

Returns `[secp256r1Verify, verifyAssetInstruction]`.

## Pattern A — Client posts `verify_asset`, program inspects

**Client transaction order:**

```
secp256r1_verify → verify_asset → your_program_ix
```

```ts
const session = await beginVerifyAsset({ messageHash });
const response = await authenticatePasskeyForVerifyAsset(session);

const [secp256r1Verify, verifyAssetIx] = await completeVerifyAsset(
  session,
  response,
);

const myIx = buildMyProgramInstruction(/* binds same messageHash */);

await sendTransaction([secp256r1Verify, verifyAssetIx, myIx], { feePayer });
```

**Your Rust program:** Scan `instructions_sysvar` for the `verify_asset` instruction that ran earlier in this transaction. Decode and verify `message_hash` matches your canonical payload.

## Pattern B — Client posts `secp256r1_verify`, program CPIs `verify_asset`

**Client transaction order:**

```
secp256r1_verify → your_program_ix
```

```ts
const session = await beginVerifyAsset({ messageHash });
const response = await authenticatePasskeyForVerifyAsset(session);

const { secp256r1Verify, signedMessageIndex, clientDataJson, assetPda } =
  await buildVerifyAssetArgs(response);

// Pass verify args to your program via instruction data
const myIx = buildMyProgramInstruction({
  asset: assetPda,
  secp256r1VerifyArgs: {
    verifyArgsRelativeIndex: -1,
    signedMessageIndex,
    clientDataJson,
  },
  messageHash: session.messageHash,
});

await sendTransaction([secp256r1Verify, myIx], { feePayer });
```

**Your Rust program:** CPI `verify_asset` using `VerifyAssetCpiBuilder` from `phygital-token-client`. The `secp256r1_verify` instruction must appear earlier in the same transaction (verified via instructions sysvar inside `verify_asset`).

## `verify_asset` instruction layout

Accounts: `asset` (writable), `instructions_sysvar`.

Args:

- `secp256r1VerifyArgs: { verifyArgsRelativeIndex, signedMessageIndex, clientDataJson }`
- `messageHash` — 32-byte WebAuthn challenge
- `expectedRpId?: string` — when set, `SHA256(rpId)` must equal authenticatorData\[0..32\]
- `expectedOrigin?: string` — when set, clientDataJSON `origin` must equal this value

```ts
const session = await beginVerifyAsset({
  messageHash,
  expectedRpId: "example.com",
  expectedOrigin: "https://example.com",
});
```

## On-chain effects

- Verifies WebAuthn signature against `messageHash`
- Sets `asset.last_sign_count` from the WebAuthn authenticatorData `signCount`
- Emits `VerifyAssetEvent`
- Does **not** change `asset.owner`
