import {
  type Address,
  getProgramDerivedAddress,
  getBytesEncoder,
} from "@solana/kit";
import {
  type Secp256r1Pubkey,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../../generated/index.js";

const TOKEN_SEED = new TextEncoder().encode("token");

/**
 * Derive the token PDA from the compressed secp256r1 passkey public key.
 * PDA seeds: `["token", pubkey[1..]]` — the compressed-point prefix byte is dropped.
 */
export async function findTokenPda(
  secp256r1Pubkey: Secp256r1Pubkey,
): Promise<Address> {
  const [token] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(TOKEN_SEED),
      getBytesEncoder().encode(secp256r1Pubkey[0].slice(1)),
    ],
  });

  return token;
}
