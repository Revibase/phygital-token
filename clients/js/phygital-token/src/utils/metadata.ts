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

/**
 * Zero-copy `PhygitalToken` layout after the 8-byte discriminator:
 * `owner` 32 | `mint` 32 | `last_sign_count` 4 | `token_type` 1 | `is_locked` 1
 * | `public_key` 33 | `identifier` 33. Total account size is
 * {@link getPhygitalTokenSize} (144).
 */
const DISCRIMINATOR_LEN = 8;
const PUBKEY_LEN = 32;
const SIGN_COUNT_LEN = 4;
const U8_LEN = 1;
const SECP256R1_PUBKEY_LEN = 33;

/** memcmp offset of `owner` in account data. */
const PHYGITAL_TOKEN_OWNER_OFFSET = DISCRIMINATOR_LEN;
/** memcmp offset of `mint` in account data. */
const PHYGITAL_TOKEN_MINT_OFFSET =
  PHYGITAL_TOKEN_OWNER_OFFSET + PUBKEY_LEN;
/** memcmp offset of `identifier` in account data. */
const PHYGITAL_TOKEN_IDENTIFIER_OFFSET =
  PHYGITAL_TOKEN_MINT_OFFSET +
  PUBKEY_LEN +
  SIGN_COUNT_LEN +
  U8_LEN +
  U8_LEN +
  SECP256R1_PUBKEY_LEN;

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
            offset: BigInt(PHYGITAL_TOKEN_IDENTIFIER_OFFSET),
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
            offset: BigInt(PHYGITAL_TOKEN_OWNER_OFFSET),
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
            offset: BigInt(PHYGITAL_TOKEN_MINT_OFFSET),
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
