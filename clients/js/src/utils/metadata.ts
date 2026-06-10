import {
  address,
  getAddressDecoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  METADATA_KEY_SECP256R1,
  TOKEN_GROUP_MEMBER_EXTENSION_TYPE,
  TOKEN_METADATA_EXTENSION_TYPE,
} from "./consts";
import { fetchAccountData } from "./slotHash";
import { getCurrentOwner } from "./tokenOwner";

const MINT_ACCOUNT_SIZE = 82;

export type TransferMintContext = {
  tokenMint: Address;
  groupMint: Address;
  secp256r1Pubkey: Uint8Array;
};

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  );
}

function readBorshString(
  data: Uint8Array,
  offset: number,
): { value: string; offset: number } {
  const length = readU32LE(data, offset);
  const start = offset + 4;
  const end = start + length;
  const value = new TextDecoder().decode(data.subarray(start, end));
  return { value, offset: end };
}

function readOptionalPubkey(
  data: Uint8Array,
  offset: number,
): { offset: number } {
  const tag = data[offset];
  return { offset: tag === 0 ? offset + 1 : offset + 33 };
}

export type TokenMetadataFields = {
  name: string;
  symbol: string;
  uri: string;
  additional: Map<string, string>;
};

function parseTokenMetadataExtension(data: Uint8Array): TokenMetadataFields {
  let offset = 0;

  ({ offset } = readOptionalPubkey(data, offset));
  offset += 32;

  const name = readBorshString(data, offset);
  const symbol = readBorshString(data, name.offset);
  const uri = readBorshString(data, symbol.offset);
  offset = uri.offset;

  const additional = new Map<string, string>();
  const additionalCount = readU32LE(data, offset);
  offset += 4;
  for (let i = 0; i < additionalCount; i += 1) {
    const key = readBorshString(data, offset);
    const value = readBorshString(data, key.offset);
    additional.set(key.value, value.value);
    offset = value.offset;
  }

  return {
    name: name.value,
    symbol: symbol.value,
    uri: uri.value,
    additional,
  };
}

function parseGroupMint(data: Uint8Array): Address {
  if (data.length < 64) {
    throw new Error("TokenGroupMember extension is too short");
  }
  return getAddressDecoder().decode(data.subarray(32, 64));
}

function walkMintExtensions(data: Uint8Array): {
  groupMint: Address | null;
  metadata: TokenMetadataFields | null;
} {
  let groupMint: Address | null = null;
  let metadata: TokenMetadataFields | null = null;
  let offset = MINT_ACCOUNT_SIZE;

  while (offset + 4 <= data.length) {
    const extensionType = readU16LE(data, offset);
    const extensionLength = readU16LE(data, offset + 2);
    const extensionStart = offset + 4;
    const extensionEnd = extensionStart + extensionLength;
    if (extensionEnd > data.length) {
      break;
    }

    const extensionData = data.subarray(extensionStart, extensionEnd);
    if (extensionType === TOKEN_GROUP_MEMBER_EXTENSION_TYPE) {
      groupMint = parseGroupMint(extensionData);
    }
    if (extensionType === TOKEN_METADATA_EXTENSION_TYPE) {
      metadata = parseTokenMetadataExtension(extensionData);
    }

    offset = extensionEnd;
  }

  return { groupMint, metadata };
}

export type CardAttribute = {
  traitType: string;
  value: string;
};

export type TokenJsonMetadata = {
  name?: string;
  image?: string;
  description?: string;
  credentialId?: string;
  /** UTC expiry as milliseconds since Unix epoch. */
  expiry?: number;
  attributes?: Array<{
    trait_type?: string;
    traitType?: string;
    value?: string | number;
  }>;
};

type JsonMetadata = TokenJsonMetadata;

function parseCardAttributes(
  raw: JsonMetadata["attributes"],
): CardAttribute[] {
  if (!raw?.length) {
    return [];
  }

  return raw
    .map((attribute) => {
      const traitType = attribute.trait_type ?? attribute.traitType;
      if (!traitType || attribute.value === undefined || attribute.value === null) {
        return null;
      }
      return {
        traitType,
        value: String(attribute.value),
      };
    })
    .filter((attribute): attribute is CardAttribute => attribute !== null);
}

async function fetchJsonMetadata(uri: string): Promise<JsonMetadata | null> {
  if (!uri) {
    return null;
  }
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as JsonMetadata;
  } catch {
    return null;
  }
}

function parseCredentialId(
  jsonMeta: TokenJsonMetadata | null,
): string | null {
  const value = jsonMeta?.credentialId?.trim();
  return value ? value : null;
}

function parseExpiry(jsonMeta: TokenJsonMetadata | null): number | null {
  const raw = jsonMeta?.expiry;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  return raw;
}

export async function resolveTokenJsonMetadata(
  rpc: Rpc<SolanaRpcApi>,
  tokenMint: Address,
): Promise<TokenJsonMetadata | null> {
  const mintData = await fetchAccountData(rpc, tokenMint);
  const tokenExtensions = walkMintExtensions(mintData);
  const uri = tokenExtensions.metadata?.uri;
  if (!uri) {
    return null;
  }
  return fetchJsonMetadata(uri);
}

export type NftDisplayInfo = {
  mint: Address;
  name: string;
  symbol: string;
  uri: string;
  image: string | null;
  description: string | null;
  attributes: CardAttribute[];
  credentialId: string | null;
  /** UTC expiry as milliseconds since Unix epoch. */
  expiry: number | null;
  collectionMint: Address | null;
  collectionName: string | null;
  currentOwner: Address;
};

export async function fetchNftDisplayInfo(
  rpc: Rpc<SolanaRpcApi>,
  tokenMint: Address,
): Promise<NftDisplayInfo> {
  const mintContext = await resolveTransferMintContext(rpc, tokenMint);
  const tokenMintData = await fetchAccountData(rpc, tokenMint);
  const tokenExtensions = walkMintExtensions(tokenMintData);
  const tokenMeta = tokenExtensions.metadata;

  const groupMintData = await fetchAccountData(rpc, mintContext.groupMint);
  const groupExtensions = walkMintExtensions(groupMintData);
  const groupMeta = groupExtensions.metadata;

  const jsonMeta = tokenMeta?.uri
    ? await fetchJsonMetadata(tokenMeta.uri)
    : null;

  return {
    mint: tokenMint,
    name: tokenMeta?.name ?? jsonMeta?.name ?? "Unknown NFT",
    symbol: tokenMeta?.symbol ?? "",
    uri: tokenMeta?.uri ?? "",
    image: jsonMeta?.image ?? null,
    description: jsonMeta?.description ?? null,
    attributes: parseCardAttributes(jsonMeta?.attributes),
    credentialId: parseCredentialId(jsonMeta),
    expiry: parseExpiry(jsonMeta),
    collectionMint: mintContext.groupMint,
    collectionName: groupMeta?.name ?? null,
    currentOwner: await getCurrentOwner(rpc, tokenMint),
  };
}

function decodeSecp256r1Pubkey(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (bytes.length !== 33) {
    throw new Error("Expected a 33-byte compressed secp256r1 public key");
  }
  return bytes;
}

export async function resolveTransferMintContext(
  rpc: Rpc<SolanaRpcApi>,
  tokenMint: Address,
): Promise<TransferMintContext> {
  const tokenMintData = await fetchAccountData(rpc, tokenMint);
  const tokenExtensions = walkMintExtensions(tokenMintData);

  if (!tokenExtensions.groupMint) {
    throw new Error("Token mint is missing a TokenGroupMember extension");
  }

  const tokenAdditional = tokenExtensions.metadata?.additional;
  if (!tokenAdditional) {
    throw new Error("Token mint is missing token metadata extension");
  }

  const secp256r1Value = tokenAdditional.get(METADATA_KEY_SECP256R1);
  if (!secp256r1Value) {
    throw new Error("Token mint is missing secp256r1 passkey metadata");
  }

  return {
    tokenMint,
    groupMint: tokenExtensions.groupMint,
    secp256r1Pubkey: decodeSecp256r1Pubkey(secp256r1Value),
  };
}
