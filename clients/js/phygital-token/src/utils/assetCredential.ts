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
} from "../generated/index.js";

/** Asset account size for memcmp filters when scanning by owner. */
const ASSET_ACCOUNT_DATA_SIZE = 115;
const ASSET_OWNER_OFF_SET = 41;

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
            offset: BigInt(ASSET_OWNER_OFF_SET),
            bytes: getBase64Decoder().decode(
              getAddressEncoder().encode(owner),
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return []
  }

  const assets = data.map((x) =>
    getAssetDecoder().decode(getBase64Encoder().encode(x.account.data[0])),
  );
  return assets;
}
