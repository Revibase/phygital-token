import {
  getAddressDecoder,
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedBytes,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  type Base64URLString,
} from "@simplewebauthn/browser";
import {
  getAssetDecoder,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  type Asset,
} from "../generated/index.js";
import { base64URLStringToBuffer } from "./passkey/internal.js";

/** Asset account size for memcmp filters when scanning by credential id. */
const ASSET_ACCOUNT_DATA_SIZE = 179;

/** Credential id field offset inside the on-chain asset account. */
const ASSET_CREDENTIAL_ID_OFFSET = 115;

const ASSET_OWNER_OFF_SET = 41;

/**
 * Resolves a passkey credential id to its on-chain asset account and secp256r1 public key.
 */
export async function fetchAssetCredentialFromCredentialId(
  credentialId: Base64URLString,
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ publicKey: Base64URLString; asset: Asset }> {
  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(ASSET_ACCOUNT_DATA_SIZE) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(ASSET_CREDENTIAL_ID_OFFSET),
            bytes: getBase64Decoder().decode(
              base64URLStringToBuffer(credentialId),
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    throw new Error("No account found.");
  }

  const asset = getAssetDecoder().decode(
    getBase64Encoder().encode(data[0].account.data[0]),
  );
  return {
    publicKey: bufferToBase64URLString(
      new Uint8Array(asset.publicKey[0]).buffer,
    ),
    asset,
  };
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
