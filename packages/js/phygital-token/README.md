# phygital-token-sdk

TypeScript client for the Phygital Token Solana program.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Choosing an integration

Most integrations only need tap authentication: it covers login and access gates, and needs no wallet, policy or SOL. The accessory wallet below is optional; use it only when the accessory itself should hold assets or approve transactions. The Revibase developer site explains which account each flow uses.

## Authenticate with an accessory

```ts
import { createSolanaRpc } from "@solana/kit";
import {
  startAuthentication,
  verifyResponse,
  findPhygitalTokenPda,
  fetchPhygitalToken,
} from "phygital-token-sdk";

const rpc = createSolanaRpc("https://api.devnet.solana.com");

// Server: store a short-lived, single-use challenge
const message = crypto.randomUUID();

// Client: NFC tap.
const response = await startAuthentication(message, { rpc });

// Server: check the signature, and that the tap was made on your site
const { isVerified, secp256r1PublicKey } = await verifyResponse({
  expectedMessage: message,
  expectedOrigin: "https://app.example.com",
  expectedRpId: "app.example.com", // the rpId the tap was requested for
  response,
});
if (!isVerified) throw new Error("bad tap");

const token = await fetchPhygitalToken(
  rpc,
  await findPhygitalTokenPda(secp256r1PublicKey),
);
// token.data.owner
```

It rejects anything that isn't a tap (`INVALID_ASSERTION`: a registration response, or no user presence) and, with `expectedRpId`, a tap made for another relying party (`RP_ID_MISMATCH`). `expectedOrigin` is your site's origin as a fixed value, not the request's `Origin` header. A tap made on another site throws `ORIGIN_MISMATCH`, so that site can't pass your challenge to a user and authenticate with their tap. It also returns `accessoryWallet`, derived locally without RPC (`null` when the signature is invalid); you only need it if you use the optional accessory wallet.

Reject expired/reused challenges and unlinked tokens before creating a session. The owner is delegated identity, not proof of wallet-key control or NFT ownership.

## Optional: accessory wallet

Each token has a wallet PDA. It is never created and pays no rent. The owner can always run instructions as it; a tap can only once the owner has created an accessory policy allowing them. Changing the owner closes that policy; assets stay in the wallet.

### Run instructions with an accessory tap

`getPhygitalWalletSigner` is a Kit modifying signer for the wallet PDA: build a normal transaction with the wallet as signer, and it
previews the owner's policy (`preview_execute`), asks for the tap, then wraps
the instructions in `execute_with_accessory`.

```ts
import { getPhygitalWalletSigner, PolicyDeniedError } from "phygital-token-sdk";

const wallet = await getPhygitalWalletSigner(rpc, phygitalTokenPda, {
  feePayer, // optional: your own fee payer(s); one is picked per transaction
  onPhaseChange: (phase) => console.log(phase),
  onFeePlan: ({ source, refillLamports }) => console.log(source, refillLamports),
});
// Use `wallet` as the signer of instructions that spend from it, then sign as usual.
// A policy refusal throws PolicyDeniedError before the tap (see below).
```

The wallet PDA has no key, so someone else pays the network fee. By default
that's the Revibase fee service (`https://portal.revibase.com/api/sponsor`): a
pool of fee payers drawing on the accessory's prepaid network fees. When those
run low, the transaction refills them from the accessory wallet (within its
tap-payment limits). Two errors arrive before the tap:

- `AccessoryWalletTopUpRequired` (`wallet`, `neededLamports`): add SOL to the accessory wallet.
- `RefillBlockedByTapLimit` (`manageUrl`): the tap-payment limits don't allow the refill; the owner refills at `manageUrl`.

Pass `feePayer` to pay fees yourself; prepaid fees are then not used. Helpers:
`fetchSponsor`, `createSponsorFeePayers`, `fetchPrepaidFees`, `planFee`.

The owner runs anything as the wallet with
`buildExecuteWithOwnerInstruction({ owner, phygitalToken, instructions })`.

#### Wallet Standard

Register once at app startup so Standard-aware connectors (e.g.
`@solana/connectors`) list "Revibase":

```ts
import { registerPhygitalWallet } from "phygital-token-sdk";

registerPhygitalWallet({ rpc, feePayer }); // feePayer optional
```

Connecting taps the accessory and exposes its token's wallet PDA (the token
needs an owner and an accessory policy). The session is kept in
`localStorage`, so a reload reconnects without another tap. Transactions are
signed through `getPhygitalWalletSigner`. The adapter does not advertise
`solana:signMessage`, since a PDA has no ed25519 key; use accessory authentication
separately for possession-based login.

The `revibase:accessory` feature exposes the connected accessory's owner:

```ts
import { getRevibaseAccessorySession } from "phygital-token-sdk";

const session = await getRevibaseAccessorySession(wallet); // null for other wallets
// { phygitalTokenPda, walletPda, owner }
await getRevibaseAccessorySession(wallet, { refresh: true }); // re-read the chain
```

### When the policy refuses

Only the owner sets the accessory's policy, in Revibase. Apps can't propose permissions. A transaction the policy refuses throws `PolicyDeniedError` before the tap:

```ts
try {
  await sendTransaction(tx, connection);
} catch (e) {
  const error = e instanceof PolicyDeniedError ? e : e?.error; // wallet-adapter wraps it
  if (error instanceof PolicyDeniedError) {
    // error.code: "program_not_allowed", "spend_limit", "origin_not_allowed", …
    // error.programs: the blocked programs, for program_not_allowed / instruction_not_allowed
    // error.manageUrl: where the owner can change the policy
  }
}
```

`POLICY_DENIAL_CODES` lists every code. The program decides what is allowed; `programs` only names what it refused.

The permission JSON (`PermissionSet`) is the format the Revibase editor imports and exports. `parsePermissionSet`, `parseRule`, `ruleToArgs` and `ruleFromProgram` validate it and convert it losslessly to and from the program's rules. Amounts are raw-unit decimal strings; selectors and byte checks are lowercase hex. A rule matches instructions whose data starts with its selector, so the program rejects a selector that repeats or prefixes another in the same program (`selectorsOverlap` checks this). `origins` uses the exact form browsers write (`https://host[:port]`, or `http://localhost[:port]`; check with `isValidOrigin`).

