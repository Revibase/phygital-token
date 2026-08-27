import {
  type Address,
  getProgramDerivedAddress,
  getBytesEncoder,
} from "@solana/kit";
import {
  type Secp256r1Pubkey,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../../generated/index.js";
import { parseSecp256r1Pubkey } from "../parseSecp256r1Pubkey.js";
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
