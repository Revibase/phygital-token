import {
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  type Address,
  type Base64EncodedBytes,
  type ReadonlyUint8Array,
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

/** `PhygitalToken` after its 8-byte discriminator: owner 32 | mint 32 | last_slot 8 | type 1 | bump 1 | public_key 33 | identifier 33. */
const DISCRIMINATOR_LEN = 8;
const PUBKEY_LEN = 32;
const LAST_SLOT_LEN = 8;
const U8_LEN = 1;
const SECP256R1_PUBKEY_LEN = 33;

/** memcmp offset of `owner` in account data. */
const PHYGITAL_TOKEN_OWNER_OFFSET = DISCRIMINATOR_LEN;
/** memcmp offset of `mint` in account data. */
const PHYGITAL_TOKEN_MINT_OFFSET = PHYGITAL_TOKEN_OWNER_OFFSET + PUBKEY_LEN;
/** memcmp offset of `identifier` in account data. */
const PHYGITAL_TOKEN_IDENTIFIER_OFFSET =
  PHYGITAL_TOKEN_MINT_OFFSET + PUBKEY_LEN + LAST_SLOT_LEN + U8_LEN + U8_LEN + SECP256R1_PUBKEY_LEN;

const tokenDecoder = getPhygitalTokenDecoder();
const base64 = getBase64Encoder();
const addressEncoder = getAddressEncoder();

/** Every token whose account bytes at `offset` equal `bytes`. */
async function tokensMatching(
  rpc: Rpc<SolanaRpcApi>,
  offset: number,
  bytes: ReadonlyUint8Array,
): Promise<PhygitalToken[]> {
  const accounts = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(getPhygitalTokenSize()) },
        {
          memcmp: {
            encoding: "base64",
            offset: BigInt(offset),
            bytes: getBase64Decoder().decode(bytes) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();
  return accounts.map((x) => tokenDecoder.decode(base64.encode(x.account.data[0])));
}

/**
 * Find the token whose on-chain `identifier` matches (via `getProgramAccounts`
 * memcmp), or `null`. When you have the card's key, `findPhygitalTokenPda` +
 * `fetchPhygitalToken` is cheaper.
 */
export async function fetchPhygitalTokenByIdentifier(
  rpc: Rpc<SolanaRpcApi>,
  identifier: string | Secp256r1Pubkey,
): Promise<PhygitalToken | null> {
  const parsed = typeof identifier === "string" ? parseSecp256r1Pubkey(identifier) : identifier;
  const [token] = await tokensMatching(rpc, PHYGITAL_TOKEN_IDENTIFIER_OFFSET, parsed[0]);
  return token ?? null;
}

/** Every token linked to `owner` (via `getProgramAccounts` memcmp). */
export function fetchPhygitalTokensByOwner(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
): Promise<PhygitalToken[]> {
  return tokensMatching(rpc, PHYGITAL_TOKEN_OWNER_OFFSET, addressEncoder.encode(owner));
}

/** Find the token whose on-chain `mint` matches (via `getProgramAccounts` memcmp), or `null`. */
export async function fetchPhygitalTokenByMint(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<PhygitalToken | null> {
  const [token] = await tokensMatching(
    rpc,
    PHYGITAL_TOKEN_MINT_OFFSET,
    addressEncoder.encode(mint),
  );
  return token ?? null;
}
