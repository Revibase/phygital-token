# SDK surface area

TypeScript package: `phygital-token-sdk` (`clients/js/phygital-token`).

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
| `findPhygitalTokenPda` | Derive the phygital token PDA to pass as `phygitalToken` |

`set_mint` authority must be `ADMIN`. The authority account is a signer but is **not** writable.

## Transfer

| Export | Purpose |
|--------|---------|
| `beginTransfer({ rpc, phygitalToken, rpId? })` | Kit `Rpc` + `Address`; slot-bound challenge; `rpId` defaults to hostname |
| `authenticatePasskeyForTransfer` | WebAuthn NFC tap |
| `completeTransfer` | Kit `TransactionSigner` recipient; `response.id` as passkey; builds secp + transfer |

## Verify (on-chain composable)

| Export | Purpose |
|--------|---------|
| `buildMessageHash(message)` | SHA-256 `message` to a 32-byte `messageHash` |
| `authenticatePasskeyForSecp256r1Verify({ messageHash, rpId? })` | Uses `messageHash` as WebAuthn challenge; `rpId` defaults to hostname |
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
| `startAuthentication` | Client: NFC tap trigger; returns WebAuthn response. Optional `rpId` defaults to hostname |
| `verifyResponse` | Server: verify tap signature; returns `{ isVerified, secp256r1PublicKey }` |

Pair `startAuthentication` (client) with `verifyResponse` (server). Every auth check needs a fresh tap — there is no signed-URL identification helper.

The passkey compressed secp256r1 public key is what downstream code reads from `response.id` (for PDA lookup, transfers, and on-chain verify). Many authenticators use that key as the WebAuthn credential id; when the browser path uses a random `allowCredentials` placeholder and the platform echoes it back, `authenticateWithWebauthn` recovers the real key from the assertion signature before returning. Chip `identifier` is a separate binding field on the token.

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
  phygitalToken: toAddress(tokenPubkey),
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
