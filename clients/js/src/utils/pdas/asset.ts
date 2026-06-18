import {
  type Address,
  getProgramDerivedAddress,
  getBytesEncoder,
} from "@solana/kit";
import { type Secp256r1Pubkey, PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../../generated";

const ASSET_SEED = new TextEncoder().encode("asset");
export async function findAssetPda(
  secp256r1Pubkey: Secp256r1Pubkey,
): Promise<Address> {
  const [asset] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_NFTS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(ASSET_SEED),
      getBytesEncoder().encode(secp256r1Pubkey[0].slice(1)),
    ],
  });

  return asset;
}
