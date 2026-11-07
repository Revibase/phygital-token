# phygital-token-sdk

Sign payloads with a Revi card, off-chain and on-chain. The SDK also includes the generated client for the [phygital-token program](https://github.com/Revibase/phygital-token/tree/master/programs/phygital-token).

```bash
pnpm add phygital-token-sdk @solana/kit
```

## How a tap signs

The browser asks the card, over WebAuthn, to sign `authorize ‖ payload`, where `payload` can be up to 631 bytes. The card returns its public key and a P-256 signature in the WebAuthn large blob.

## Enroll a card

A card has no product key until it's enrolled. One tap creates it:

```ts
import { enrollCard } from "phygital-token-sdk";

const response = await enrollCard(challenge); // a challenge you issued, as bytes
```

`response.rawId` is the product key (33-byte compressed P-256), the seed of the token's PDA. Before trusting the key, check the response's `clientDataJSON` (a `webauthn.create` over your challenge, on your origin) and its packed attestation up to the Revi root. Enrolling again returns the same key, freshly attested, so a failed registration can just ask again.

## Sign and verify

```ts
import { startAuthentication, verifyResponse, findPhygitalTokenPda } from "phygital-token-sdk";

const message = crypto.randomUUID(); // single-use

const response = await startAuthentication(message); // one NFC tap
const { publicKey } = verifyResponse(response, message); // throws unless the card signed it
const token = await findPhygitalTokenPda(publicKey);
```

Both functions take a string (signed as UTF-8) or bytes. `verifyResponse` returns the key the card reported, so look it up before trusting it.

Starting a tap closes the SDK's previous prompt if it's still open. Pass `{ signal }` to close a prompt early.

## Prove a tap on-chain

```ts
import { getSecp256r1VerifyInstruction } from "phygital-token-sdk";

const response = await startAuthentication(payload);
const tap = verifyResponse(response, payload);
const instructions = [getSecp256r1VerifyInstruction([tap]), yourInstruction];
```

Your program must check that the signed message is `authorize ‖ payload` and that the key is one it trusts.

## Also exported

- **The generated program client**, covering accounts, instructions and errors.
- **Token-account helpers:** `findPhygitalTokenPda`, `parseSecp256r1Pubkey`, `fetchPhygitalTokenByIdentifier`, `fetchPhygitalTokensByOwner` and `isPhygitalTokenLocked`.
- **`PhygitalTokenError`**, whose `code` is one of `INVALID_PUBLIC_KEY`, `WEBAUTHN_UNSUPPORTED`, `AUTHENTICATION_CANCELLED`, `INVALID_ASSERTION` or `INVALID_ARGUMENT`.

## Develop

```bash
pnpm --filter phygital-token-sdk typecheck && pnpm --filter phygital-token-sdk test
pnpm --filter phygital-token-sdk api:update   # when the exported surface changes; commit api/
```

Never edit `src/generated/` by hand. Running `pnpm build:program` at the repo root regenerates it. Record releases in [CHANGELOG.md](CHANGELOG.md).
