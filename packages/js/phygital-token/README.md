# phygital-token-sdk

TypeScript client for the Phygital Token Solana program.

## Install

```bash
pnpm add phygital-token-sdk @solana/kit
```

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

It rejects anything that isn't a tap (`INVALID_ASSERTION`: a registration response, or no user presence) and, with `expectedRpId`, a tap made for another relying party (`RP_ID_MISMATCH`). `expectedOrigin` is your site's origin as a fixed value, not the request's `Origin` header. A tap made on another site throws `ORIGIN_MISMATCH`, so that site can't pass your challenge to a user and authenticate with their tap.

Reject expired/reused challenges and unlinked tokens before creating a session. The owner is delegated identity, not proof of wallet-key control or NFT ownership.

## Claim ownership

A tap makes a wallet the token's owner (`set_owner`). The wallet must sign the
transaction; the tap itself does not name it, so the tap can happen on a phone
before the wallet that finishes the claim (in a wallet app's browser or on a
computer) is chosen.

```ts
import {
  beginTransfer,
  authenticatePasskeyForTransfer,
  completeTransfer,
} from "phygital-token-sdk";

const session = await beginTransfer({ rpc, secp256r1Pubkey }); // reads a recent slot hash
const response = await authenticatePasskeyForTransfer(session); // NFC tap
const instructions = await completeTransfer(session, response, recipientSigner);
// Send `instructions` in one transaction signed by `recipientSigner` before the
// slot hash leaves SlotHashes (512 slots, about three minutes).
```

`set_owner` refuses Controlled and Permanent tokens that already have an owner
(`isPhygitalTokenLocked`). An assertion is single-use, but anyone who sees it
before it lands could submit it for their own wallet, so send it promptly and
only to a trusted RPC.
