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
import { parseSecp256r1Pubkey } from "../parseSecp256r1Pubkey.js";
import { recoverSecp256r1PublicKeyCandidates } from "../passkey/internal.js";
import type { Base64URLString } from "../passkey/webauthn.js";

const TOKEN_SEED = new TextEncoder().encode("token");

/**
 * Derive the token PDA from the compressed secp256r1 passkey public key.
 * Accepts a parsed {@link Secp256r1Pubkey} or a base64url-encoded string
 * (the same shape as `verifyResponse().secp256r1PublicKey`).
 * PDA seeds: `["token", pubkey[1..]]` — the compressed-point prefix byte is dropped.
 */
export async function findPhygitalTokenPda(
  secp256r1Pubkey: Secp256r1Pubkey | Base64URLString,
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
  message: Uint8Array,
): Promise<Uint8Array> {
  const candidates = recoverSecp256r1PublicKeyCandidates(signature, message);
  if (candidates.length === 0) {
    throw new Error("Failed to recover secp256r1 public key from signature");
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const tokenAccounts = await fetchAllMaybePhygitalToken(
    rpc,
    await Promise.all(candidates.map((candidate) => findPhygitalTokenPda([candidate]))),
  );
  const matches = tokenAccounts.filter((account) => account.exists);

  if (matches.length === 1) {
    return new Uint8Array(matches[0].data.publicKey[0]);
  }

  if (matches.length === 0) {
    throw new Error(
      "No recovered secp256r1 public key matches an initialized PhygitalToken on-chain.",
    );
  }

  throw new Error(
    "Ambiguous secp256r1 public key recovery: multiple keys match PhygitalToken accounts.",
  );
}
