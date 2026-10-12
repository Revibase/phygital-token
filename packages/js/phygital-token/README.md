# phygital-token-sdk

TypeScript client for the Phygital Token Solana program.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

## Sign in with an accessory

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
  response,
});
if (!isVerified) throw new Error("bad tap");

const token = await fetchPhygitalToken(
  rpc,
  await findPhygitalTokenPda(secp256r1PublicKey),
);
// token.data.owner
```

`expectedOrigin` is your site's origin as a fixed value, not the request's `Origin` header. A tap made on another site throws `ORIGIN_MISMATCH`, so that site can't pass your challenge to a user and sign in with their tap. It also returns `accessoryWallet`, derived locally without RPC (`null` when the signature is invalid).

Reject expired/reused challenges and unlinked tokens before creating a session. The owner is delegated identity, not proof of wallet-key control or NFT ownership.

## On-chain `verify` (CPI)

```ts
import {
  buildMessageHash,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "phygital-token-sdk";

const messageHash = buildMessageHash(message);
const tap = await authenticatePasskeyForSecp256r1Verify({ rpc, messageHash });
const { secp256r1VerifyInstruction, phygitalTokenPda, secp256r1VerifyArgs } =
  await buildSecp256r1VerifyInstruction(tap);
```

## Wallet: run instructions with an accessory tap

Each token has a wallet PDA. `getPhygitalWalletSigner` is a Kit modifying
signer for it: build a normal transaction with the wallet as signer, and it
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
// A policy refusal throws PolicyDeniedError (e.g. code "spend_not_allowed") before the tap.
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

### Wallet Standard

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
separately for possession-based sign-in.

The `revibase:accessory` feature exposes the connected accessory's owner:

```ts
import { getRevibaseAccessorySession } from "phygital-token-sdk";

const session = await getRevibaseAccessorySession(wallet); // null for other wallets
// { phygitalTokenPda, walletPda, owner }
await getRevibaseAccessorySession(wallet, { refresh: true }); // re-read the chain
```

## Choosing an integration

Use tap authentication for login/access gates and Wallet Standard for accessory-wallet transactions. The developer site's "Choose your integration" guide (in the separate `developer` repository) explains which account each flow uses.

## Request accessory permissions

Projects can ask owners to configure an accessory through a reusable link or QR code:

```ts
import { encodePermissionRequest, type PermissionSet } from 'phygital-token-sdk';

const permissions: PermissionSet = {
  v: 1,
  name: 'My project',
  reason: 'Transfer SOL when you tap to pay',
  programs: [{
    id: '11111111111111111111111111111111',
    access: { only: [{ selector: '02000000' }] }
  }],
  limits: [{ asset: 'SOL', amount: '100000000', period: 'day', maxPerTap: '10000000' }],
  origins: ['https://app.example.com'] // your site
};
const url = await encodePermissionRequest(permissions);
// Render `url` as a link or QR code.
```

Amounts are raw-unit decimal strings; selectors and byte checks are lowercase hex. Periods support `day`, `week`, `month`, `lifetime`, or a number of seconds. Rules can constrain data length, account count, account keys (`wallet` means the accessory wallet), owners, signer/writable flags, account data and instruction arguments. Each instruction gets at most one rule per program: a rule matches instructions whose data starts with its selector, so the program rejects a selector that repeats or prefixes another in the same program (`selectorsOverlap` checks this). `parseRule` also rejects checks within a rule that can never all hold, such as an amount above 10,000 and below 5,000, bytes that disagree with the selector, or one account required to have two different addresses; the program would save such a rule, but it would never match. `parsePermissionSet`, `parseRule`, `ruleToArgs` and `ruleFromProgram` provide validation and lossless conversion.

`origins` lists the sites that may ask for a tap, exactly as browsers write them (`https://host[:port]`, or `http://localhost[:port]`; check with `isValidOrigin`). Owners can limit their accessory to some sites; a request's origins are added to that list, and change nothing when the owner allows any site. A tap from an unlisted site is refused before the tap with `PolicyDeniedError` code `origin_not_allowed`. The check binds browser taps only: a native app talking to the accessory directly can claim any origin.

Links contain a deflate-raw/base64url fragment (`#r=`), capped at 4 KB compressed and 64 KB decoded; the fragment never reaches the server. The schema allows at most 64 programs, 32 rules per program, 16 asset limits and 16 origins, rejects duplicate entries and unknown fields, and enforces the program's rule checks. `decodePermissionRequest` reads links or payloads. Alternatively, host the JSON with CORS enabled and link to `https://portal.revibase.com/permissions?src=<encoded HTTPS URL>`; `fetchPermissionRequest` fetches it without cookies or redirects and caps the response size.

The link does not choose an accessory: owners connect and select one. Revibase reviews only missing permissions and increases to existing limits, preserves existing access and shorter recurring reset windows, and warns about unknown/upgradeable programs and dangerous actions. Owners must acknowledge danger and can edit before approving. A source hostname identifies the origin of a request, not its trustworthiness.
