import {
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedBytes,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  getAssetDecoder,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  type Asset,
  type Secp256r1Pubkey,
} from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../instructions/initialize.js";

/** Asset account size: 8 disc + 1 type + 32 owner + 8 slot + 1 lock + 33 pubkey + 33 identifier. */
const ASSET_ACCOUNT_DATA_SIZE = 116;
const ASSET_OWNER_OFFSET = 9;
/** Offset of `public_key` (33 bytes) within account data. */
const ASSET_PUBLIC_KEY_OFFSET = 50;

/**
 * Find assets whose on-chain `public_key` matches the passkey
 * (via `getProgramAccounts` memcmp — PDA is seeded by identifier, not pubkey).
 */
export async function fetchAssetsByPublicKey(
  rpc: Rpc<SolanaRpcApi>,
  secp256r1PublicKey: string | Secp256r1Pubkey,
): Promise<Asset[]> {
  const pubkey =
    typeof secp256r1PublicKey === "string"
      ? parseSecp256r1Pubkey(secp256r1PublicKey)
      : secp256r1PublicKey;

  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(ASSET_ACCOUNT_DATA_SIZE) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(ASSET_PUBLIC_KEY_OFFSET),
            bytes: getBase64Decoder().decode(
              pubkey[0],
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return [];
  }

  return data.map((x) =>
    getAssetDecoder().decode(getBase64Encoder().encode(x.account.data[0])),
  );
}

export async function fetchAllAssetsFromOwner(
  owner: Address,
  rpc: Rpc<SolanaRpcApi>,
): Promise<Asset[]> {
  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(ASSET_ACCOUNT_DATA_SIZE) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(ASSET_OWNER_OFFSET),
            bytes: getBase64Decoder().decode(
              getAddressEncoder().encode(owner),
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return [];
  }

  return data.map((x) =>
    getAssetDecoder().decode(getBase64Encoder().encode(x.account.data[0])),
  );
}
