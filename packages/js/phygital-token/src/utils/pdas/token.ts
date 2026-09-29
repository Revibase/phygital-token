import {
  type Address,
  getProgramDerivedAddress,
  getBytesEncoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  type Secp256r1Pubkey,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../../generated/index.js";
import { fetchAllMaybePhygitalToken } from "../../generated/accounts/phygitalToken.js";
import { PhygitalTokenError } from "../errors.js";
import { parseSecp256r1Pubkey } from "../parseSecp256r1Pubkey.js";
import { recoverSecp256r1PublicKeyCandidates } from "../passkey/internal.js";
import {
  bufferToBase64URLString,
  type Base64URLString,
} from "../passkey/webauthn.js";

const TOKEN_SEED = new TextEncoder().encode("token");

/**
 * Derive the token PDA from the compressed secp256r1 passkey public key.
 * Accepts a parsed {@link Secp256r1Pubkey} or a base64url-encoded string
 * (the same shape as a recovered phygital `response.id` / compressed passkey).
 * PDA seeds: `["token", pubkey[1..]]` — the compressed-point prefix byte is dropped.
 */
export async function findPhygitalTokenPda(
  secp256r1Pubkey: Secp256r1Pubkey | Base64URLString
): Promise<Address> {
  const pubkey =
    typeof secp256r1Pubkey === "string"
      ? parseSecp256r1Pubkey(secp256r1Pubkey)
      : secp256r1Pubkey;

  const [token] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(TOKEN_SEED),
      getBytesEncoder().encode(pubkey[0].slice(1)),
    ],
  });

  return token;
}

/**
 * Recover a compressed secp256r1 public key from a WebAuthn assertion.
 * When multiple keys verify the signature, selects the candidate whose
 * {@link findPhygitalTokenPda} exists on-chain.
 */
export async function recoverSecp256r1PublicKeyWithPhygitalToken(
  rpc: Rpc<SolanaRpcApi>,
  signature: Uint8Array,
  message: Uint8Array
): Promise<Uint8Array> {
  const candidates = recoverSecp256r1PublicKeyCandidates(signature, message);
  if (candidates.length === 0) {
    throw new PhygitalTokenError(
      "PASSKEY_RECOVERY_FAILED",
      "Could not read a passkey from this tap. Tap the tag again."
    );
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const tokenAccounts = await fetchAllMaybePhygitalToken(
    rpc,
    await Promise.all(
      candidates.map((candidate) => findPhygitalTokenPda([candidate]))
    )
  );
  const matches = tokenAccounts.filter((account) => account.exists);

  if (matches.length === 1) {
    return new Uint8Array(matches[0].data.publicKey[0]);
  }

  if (matches.length === 0) {
    throw new PhygitalTokenError(
      "PASSKEY_NOT_RECOGNIZED",
      "This tag is not a registered phygital token."
    );
  }

  throw new PhygitalTokenError(
    "PASSKEY_AMBIGUOUS",
    "Could not tell which passkey signed: multiple registered tokens match. Tap again."
  );
}

/**
 * Offline variant of {@link recoverSecp256r1PublicKeyWithPhygitalToken}: picks
 * the single verifying candidate that is in `allowList`, with no network call.
 */
export function recoverSecp256r1PublicKeyWithAllowList(
  allowList: ReadonlySet<Base64URLString>,
  signature: Uint8Array,
  message: Uint8Array
): Uint8Array {
  const candidates = recoverSecp256r1PublicKeyCandidates(signature, message);
  if (candidates.length === 0) {
    throw new PhygitalTokenError(
      "PASSKEY_RECOVERY_FAILED",
      "Could not read a passkey from this tap. Tap the tag again."
    );
  }

  const matches = candidates.filter((candidate) =>
    allowList.has(bufferToBase64URLString(candidate))
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length === 0) {
    throw new PhygitalTokenError(
      "PASSKEY_NOT_RECOGNIZED",
      "This tag is not in the allowed set of passkeys."
    );
  }

  throw new PhygitalTokenError(
    "PASSKEY_AMBIGUOUS",
    "Could not tell which passkey signed: multiple allowed keys match. Tap again."
  );
}
