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
  getPhygitalTokenDecoder,
  getPhygitalTokenSize,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
  type PhygitalToken,
  type Secp256r1Pubkey,
} from "../generated/index.js";
import { parseSecp256r1Pubkey } from "./parseSecp256r1Pubkey.js";

const OWNER_OFFSET = 9;
/** Offset of `identifier` (33 bytes) within account data. */
const IDENTIFIER_OFFSET = 79;
const MINT_OFFSET = 112;

/**
 * Find the token whose on-chain `identifier` matches (via `getProgramAccounts`
 * memcmp). Returns `null` if none. Prefer `findPhygitalTokenPda` +
 * `fetchPhygitalToken` when you already know the passkey — the PDA is seeded
 * by that public key. `rpc` is a Kit `Rpc`.
 */
export async function fetchPhygitalTokenByIdentifier(
  rpc: Rpc<SolanaRpcApi>,
  identifier: string | Secp256r1Pubkey,
): Promise<PhygitalToken | null> {
  const parsed =
    typeof identifier === "string"
      ? parseSecp256r1Pubkey(identifier)
      : identifier;

  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getPhygitalTokenSize()) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(IDENTIFIER_OFFSET),
            bytes: getBase64Decoder().decode(parsed[0]) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return null;
  }

  return getPhygitalTokenDecoder().decode(
    getBase64Encoder().encode(data[0].account.data[0]),
  );
}

/**
 * List tokens owned by `owner` (via `getProgramAccounts` memcmp).
 * `rpc` and `owner` are Kit types (`Rpc`, `Address`).
 */
export async function fetchPhygitalTokensByOwner(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
): Promise<PhygitalToken[]> {
  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getPhygitalTokenSize()) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(OWNER_OFFSET),
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
    getPhygitalTokenDecoder().decode(
      getBase64Encoder().encode(x.account.data[0]),
    ),
  );
}

/**
 * Find the token whose on-chain `mint` matches (via `getProgramAccounts`
 * memcmp). Returns `null` if none. `mint` and `rpc` are Kit types.
 */
export async function fetchPhygitalTokenByMint(
  mint: Address,
  rpc: Rpc<SolanaRpcApi>,
): Promise<PhygitalToken | null> {
  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getPhygitalTokenSize()) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(MINT_OFFSET),
            bytes: getBase64Decoder().decode(
              getAddressEncoder().encode(mint),
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    return null;
  }

  return getPhygitalTokenDecoder().decode(
    getBase64Encoder().encode(data[0].account.data[0]),
  );
}
