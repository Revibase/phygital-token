import { sha256 } from "@noble/hashes/sha2.js";
import {
  type Address,
  getProgramDerivedAddress,
  getBytesEncoder,
} from "@solana/kit";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../../generated";
const DOMAIN_CONFIG_SEED = new TextEncoder().encode("domain_config");

export async function findDomainConfigPda(rpId?: string, rpIdHash?:Uint8Array): Promise<Address> {
  const [domainConfig] = await getProgramDerivedAddress({
    programAddress: PHYGITAL_NFTS_PROGRAM_ADDRESS,
    seeds: [
      getBytesEncoder().encode(DOMAIN_CONFIG_SEED),
      getBytesEncoder().encode(rpIdHash ?? sha256(new TextEncoder().encode(rpId))),
    ],
  });

  return domainConfig;
}
