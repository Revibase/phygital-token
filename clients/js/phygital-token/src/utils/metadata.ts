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
/** Offset of `identifier` (33 bytes) within account data. */
const ASSET_IDENTIFIER_OFFSET = 83;

/**
 * Find the asset whose on-chain `identifier` matches (via `getProgramAccounts`
 * memcmp). Returns `null` if none. Prefer `findAssetPda` + `fetchAsset` when
 * you already know the passkey — the PDA is seeded by that public key.
 */
export async function fetchAssetByIdentifier(
  rpc: Rpc<SolanaRpcApi>,
  identifier: string | Secp256r1Pubkey,
): Promise<Asset | null> {
  const parsed =
    typeof identifier === "string"
      ? parseSecp256r1Pubkey(identifier)
      : identifier;

  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(ASSET_ACCOUNT_DATA_SIZE) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(ASSET_IDENTIFIER_OFFSET),
            bytes: getBase64Decoder().decode(
              parsed[0],
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return null;
  }

  return getAssetDecoder().decode(
    getBase64Encoder().encode(data[0].account.data[0]),
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
