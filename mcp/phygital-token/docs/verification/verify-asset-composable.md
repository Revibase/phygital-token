# Composable `verify_asset` (TypeScript)

On-chain passkey authentication for custom programs. **Not** the same as off-chain `startAuthentication` + `verifyResponse`.

## Session flow

```
beginVerifyAsset({ rpc, message })
        ↓
authenticatePasskeyForVerifyAsset(session)   // WebAuthn NFC tap
        ↓
buildVerifyAssetArgs(session, response)      // or completeVerifyAsset(...)
        ↓
assemble transaction (Pattern A or B below)
```

## Functions

### `beginVerifyAsset({ rpc, message: Uint8Array })`

Slot-bound challenge: `SHA256("verify_asset" || SHA256(message) || slotHash)`.

### `buildVerifyAssetArgs(session, response)`

Resolves the asset PDA from `response.id` (compressed secp256r1 public key / WebAuthn credential id). Returns `secp256r1Verify`, `signedMessageIndex`, `clientDataJson`, `asset`, `assetPda`.

### `completeVerifyAsset(session, response)`

Returns `[secp256r1Verify, verifyAssetInstruction]`.

## Pattern A — Client posts `verify_asset`, program inspects

**Client transaction order:**

```
secp256r1_verify → verify_asset → your_program_ix
```

```ts
const session = await beginVerifyAsset({ rpc, message });
const response = await authenticatePasskeyForVerifyAsset(session);

const [secp256r1Verify, verifyAssetIx] = await completeVerifyAsset(
  session,
  response,
);

const myIx = buildMyProgramInstruction(/* binds same message bytes */);

await sendTransaction([secp256r1Verify, verifyAssetIx, myIx], { feePayer });
```

**Your Rust program:** Scan `instructions_sysvar` for the `verify_asset` instruction that ran earlier in this transaction. Decode and verify `message` matches your canonical payload. Reference: `phygital-spend`.

## Pattern B — Client posts `secp256r1_verify`, program CPIs `verify_asset`

**Client transaction order:**

```
secp256r1_verify → your_program_ix
```

```ts
const session = await beginVerifyAsset({ rpc, message });
const response = await authenticatePasskeyForVerifyAsset(session);

const { secp256r1Verify, signedMessageIndex, clientDataJson, assetPda } =
  await buildVerifyAssetArgs(session, response);

// Pass verify args to your program via instruction data
const myIx = buildMyProgramInstruction({
  asset: assetPda,
  secp256r1VerifyArgs: {
    signedMessageIndex,
    slotNumber: session.slotNumber,
    clientDataJson,
  },
  message: session.message,
});

await sendTransaction([secp256r1Verify, myIx], { feePayer });
```

**Your Rust program:** CPI `verify_asset` using `VerifyAssetCpiBuilder` from `phygital-token-client`. The `secp256r1_verify` instruction must appear earlier in the same transaction (verified via instructions sysvar inside `verify_asset`).

## `verify_asset` instruction layout

Accounts: `asset` (writable), `slot_hashes`, `instructions_sysvar`.

Args: `{ secp256r1VerifyArgs: { signedMessageIndex, slotNumber, clientDataJson }, message }`.

## On-chain effects

- Verifies WebAuthn signature against slot-bound challenge
- Sets `asset.last_transfer_slot = slotNumber`
- Emits `VerifyAssetEvent`
- Does not change token owner or balance
