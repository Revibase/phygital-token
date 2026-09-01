# SDK surface area

TypeScript package: `phygital-token-sdk` (`clients/js/phygital-token`).

## WebAuthn credential id

| `rawId` length | Behavior |
|----------------|----------|
| 33 bytes | Authenticator returned the secp256r1 public key — used as `response.id` |
| 16 bytes | Platform echoed random placeholder — recover from signature |

When recovery is ambiguous, the SDK selects the candidate with an initialized PhygitalToken PDA on-chain. **Browser WebAuthn requires Kit `Rpc`** on all tap helpers.

## Initialize

| Export | Purpose |
|--------|---------|
| `getInitializeInstruction` | Create token PDA (seeded by passkey `secp256r1Pubkey`; pass token PDA from `findPhygitalTokenPda`) |
| `parseSecp256r1Pubkey` | Parse a base64url 33-byte compressed secp256r1 public key |
| `ADMIN` / `INITIALIZE_MULTISIG_PDA` | Admin vault and the Squads multisig that owns it on mainnet |

`ADMIN` (`G6k…EjoF`) is Squads vault-0 of `INITIALIZE_MULTISIG_PDA` (`EU7…Kn7U`). Derive the token PDA with `findPhygitalTokenPda`, then pass it to `getInitializeInstruction`. Wrap the kit instruction with your own Squads client if the vault must sign.

## Set mint

| Export | Purpose |
|--------|---------|
| `getSetMintInstruction` | Bind an SPL mint pubkey onto `phygital_token.mint` (authority defaults to `ADMIN`) |
| `findPhygitalTokenPda` | Derive the phygital token PDA from a passkey public key |

`set_mint` authority must be `ADMIN`. The authority account is a signer but is **not** writable.

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer({ rpc, secp256r1Pubkey, rpId? })` | Derives token PDA from passkey; slot-bound challenge; `rpId` defaults to hostname |
| `authenticatePasskeyForTransfer(session)` | WebAuthn NFC tap; passes `secp256r1Pubkey` in `allowCredentials` |
| `completeTransfer` | Kit `TransactionSigner` recipient; `response.id` as passkey; builds secp + transfer |

## Verify (on-chain composable)

| Export | Purpose |
|--------|---------|
| `buildMessageHash(message)` | SHA-256 `message` to a 32-byte `messageHash` |
| `authenticatePasskeyForSecp256r1Verify({ rpc, messageHash, rpId? })` | Uses `messageHash` as WebAuthn challenge; `rpc` required |
| `buildSecp256r1VerifyInstruction` | After tap: `{ secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs }` |
| `getVerifyInstruction` | Generated `verify` ix — `expectedRpId` / `expectedOrigins` are `Option` (`null` skips). CPI callers set these on `VerifyCpiBuilder`, not the tap helper. |

See `verification:verify-composable` and `building-on-phygital:rust-cpi`. When `expectedOrigins` is set, `clientDataJSON.origin` must match one listed origin.

## Remove ownership

| Export | Purpose |
|--------|---------|
| `getRemoveOwnershipInstruction` | Wallet-signed forfeiture — reset `phygital_token.owner` to default |

## Verification (off-chain only)

| Export | Purpose |
|--------|---------|
| `startAuthentication(message, rpc, options?)` | Client: NFC tap; `rpc` required for browser placeholder recovery |
| `verifyResponse` | Server: verify tap signature; returns `{ isVerified, secp256r1PublicKey }` |

Pair `startAuthentication` (client) with `verifyResponse` (server). Every auth check needs a fresh tap — there is no signed-URL identification helper.

## Token lookup

| Export | Purpose |
|--------|---------|
| `findPhygitalTokenPda` | Derive token PDA from passkey public key (base64url string or parsed `Secp256r1Pubkey`) |
| `fetchPhygitalTokenByIdentifier` | Kit `Rpc`; `getProgramAccounts` memcmp on chip `identifier` |
| `fetchPhygitalTokensByOwner` | Kit `Rpc` + `Address` owner |
| `fetchPhygitalTokenByMint` | Kit `Address` mint + Kit `Rpc` |
| `fetchPhygitalToken` | Generated helper — Kit `Rpc` + token PDA |

## web3.js

No `@solana/web3.js` dependency. SDK functions take Kit types (`Rpc`, `Address`, `TransactionSigner`, `Instruction`). Convert yourself:

| Export | Purpose |
|--------|---------|
| `toRpc` | `Connection` or RPC URL → Kit `Rpc` |
| `toAddress` | `PublicKey` or base58 string → Kit `Address` |
| `toTransactionSigner` | `Keypair` / `{ publicKey }` → no-op Kit signer (caller signs the web3.js tx) |
| `toWeb3Instruction` / `toWeb3Instructions` | Kit `Instruction` → web3.js `TransactionInstruction` shape for `tx.add()` |

```ts
const session = await beginTransfer({
  rpc: toRpc(connection),
  secp256r1Pubkey: secp256r1PublicKey, // base64url compressed passkey
});
const ixs = await completeTransfer(
  session,
  tap,
  toTransactionSigner(recipientKeypair),
);
tx.add(...toWeb3Instructions(ixs));
```

## Generated (Codama)

Re-exported from `./generated/index.js`:

- Instructions: `getInitializeInstruction`, `getTransferOwnershipInstruction`, `getVerifyInstruction`, `getRemoveOwnershipInstruction`, `getSetLockStateInstruction`, `getSetMintInstruction`, ...
- Accounts: `fetchPhygitalToken`, `PhygitalToken`, ...
- Types: `PhygitalTokenType`, `Secp256r1Pubkey`, ...

## Rust client

Crate: `phygital-token-client` at `clients/rust/phygital-token`.

On-chain: instruction builders, CPI helpers (`VerifyCpiBuilder`, `SetMintCpiBuilder`, `TransferOwnershipCpiBuilder`, …), account layouts, errors. `VerifyCpiBuilder.expected_rp_id` / `.expected_origins` are optional (`Option`); omit them to skip those checks.

Off-chain (`fetch` feature): RPC account fetching helpers.
