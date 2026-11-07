import { type Address, getProgramDerivedAddress, type ReadonlyUint8Array } from "@solana/kit";
import { type Secp256r1Pubkey, PHYGITAL_TOKEN_PROGRAM_ADDRESS } from "../../generated/index.js";
import { parseSecp256r1Pubkey } from "../parseSecp256r1Pubkey.js";
import type { Base64URLString } from "../passkey/webauthn.js";

const TOKEN_SEED = new TextEncoder().encode("token");

/**
 * Derive the token PDA from the card's compressed public key: the bytes
 * `verifyResponse` returns, a base64url string, or a parsed {@link Secp256r1Pubkey}.
 * PDA seeds: `["token", pubkey[1..]]` — the compressed-point prefix byte is dropped.
 */
export async function findPhygitalTokenPda(
  secp256r1Pubkey: ReadonlyUint8Array | Secp256r1Pubkey | Base64URLString,
): Promise<Address> {
  const [bytes] =
    typeof secp256r1Pubkey === "string"
      ? parseSecp256r1Pubkey(secp256r1Pubkey)
      : Array.isArray(secp256r1Pubkey)
        ? (secp256r1Pubkey as Secp256r1Pubkey)
        : [secp256r1Pubkey as ReadonlyUint8Array];

  const [token] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    seeds: [TOKEN_SEED, bytes.subarray(1)],
  });

  return token;
}
