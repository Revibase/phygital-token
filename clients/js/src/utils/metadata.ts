import {
  address,
  getAddressDecoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { PHYGITAL_NFTS_PROGRAM_ADDRESS } from "../generated/programs/phygitalNfts";
import {
  TOKEN_GROUP_MEMBER_EXTENSION_TYPE,
  TOKEN_METADATA_EXTENSION_TYPE,
} from "./consts";
import { fetchAccountData } from "./slotHash";

const MINT_ACCOUNT_SIZE = 82;
const CARD_INSTANCE_DISCRIMINATOR_SIZE = 8;
const PUBKEY_SIZE = 32;

export type TransferMintContext = {
  cardInstance: Address;
  designMint: Address;
  groupMint: Address;
};

export type ParsedCardInstance = {
  cardInstance: Address;
  uri: string;
  designMint: Address;
  owner: Address;
  lastTransferSlot: bigint;
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

function readU64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset + offset, 8);
  return view.getBigUint64(0, true);
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

export async function parseCardInstanceAccount(
  rpc: Rpc<SolanaRpcApi>,
  cardInstance: Address,
): Promise<ParsedCardInstance> {
  const account = await rpc
    .getAccountInfo(cardInstance, { commitment: "confirmed" })
    .send();

  if (!account.value) {
    throw new Error(`Card instance account not found: ${cardInstance}`);
  }

  if (address(account.value.owner) !== address(PHYGITAL_NFTS_PROGRAM_ADDRESS)) {
    throw new Error("Address is not a card instance PDA");
  }

  const data = await fetchAccountData(rpc, cardInstance);
  const minSize =
    CARD_INSTANCE_DISCRIMINATOR_SIZE + 4 + PUBKEY_SIZE + PUBKEY_SIZE + 8;
  if (data.length < minSize) {
    throw new Error("Card instance account data is too short");
  }

  const bodyOffset = CARD_INSTANCE_DISCRIMINATOR_SIZE;
  const uri = readBorshString(data, bodyOffset);
  const designMintOffset = uri.offset;
  const designMint = getAddressDecoder().decode(
    data.subarray(designMintOffset, designMintOffset + PUBKEY_SIZE),
  );
  const ownerOffset = designMintOffset + PUBKEY_SIZE;
  const owner = getAddressDecoder().decode(
    data.subarray(ownerOffset, ownerOffset + PUBKEY_SIZE),
  );
  const lastTransferSlot = readU64LE(data, ownerOffset + PUBKEY_SIZE);

  return {
    cardInstance,
    uri: uri.value,
    designMint,
    owner,
    lastTransferSlot,
  };
}

export type CardAttribute = {
  traitType: string;
  value: string;
};

export type TokenJsonMetadata = {
  name?: string;
  image?: string;
  description?: string;
  secp256r1Pubkey?: string;
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

export async function resolveCardInstanceJsonMetadata(
  rpc: Rpc<SolanaRpcApi>,
  cardInstance: Address,
): Promise<TokenJsonMetadata | null> {
  const instance = await parseCardInstanceAccount(rpc, cardInstance);
  if (!instance.uri) {
    return null;
  }
  return fetchJsonMetadata(instance.uri);
}

export async function resolveDesignMintContext(
  rpc: Rpc<SolanaRpcApi>,
  designMint: Address,
): Promise<{ designMint: Address; groupMint: Address }> {
  const designMintData = await fetchAccountData(rpc, designMint);
  const designExtensions = walkMintExtensions(designMintData);

  if (!designExtensions.groupMint) {
    throw new Error("Design mint is missing a TokenGroupMember extension");
  }

  if (!designExtensions.metadata) {
    throw new Error("Design mint is missing token metadata extension");
  }

  return {
    designMint,
    groupMint: designExtensions.groupMint,
  };
}

export async function resolveTransferMintContext(
  rpc: Rpc<SolanaRpcApi>,
  cardInstance: Address,
): Promise<TransferMintContext> {
  const instance = await parseCardInstanceAccount(rpc, cardInstance);
  const designContext = await resolveDesignMintContext(rpc, instance.designMint);

  return {
    cardInstance,
    designMint: designContext.designMint,
    groupMint: designContext.groupMint,
  };
}

export async function resolveTokenJsonMetadata(
  rpc: Rpc<SolanaRpcApi>,
  designMint: Address,
): Promise<TokenJsonMetadata | null> {
  const mintData = await fetchAccountData(rpc, designMint);
  const tokenExtensions = walkMintExtensions(mintData);
  const uri = tokenExtensions.metadata?.uri;
  if (!uri) {
    return null;
  }
  return fetchJsonMetadata(uri);
}

export type NftDisplayInfo = {
  /** Card instance PDA — unique per physical card. */
  cardInstance: Address;
  /** Shared design mint (SFT). */
  designMint: Address;
  /** @deprecated Use designMint for token explorer links. */
  mint: Address;
  name: string;
  symbol: string;
  /** Design metadata URI (shared visual/name info). */
  uri: string;
  /** Card instance metadata URI (per-card passkey/credential data). */
  cardUri: string;
  image: string | null;
  description: string | null;
  attributes: CardAttribute[];
  credentialId: string | null;
  /** UTC expiry as milliseconds since Unix epoch. */
  expiry: number | null;
  collectionMint: Address | null;
  collectionName: string | null;
  currentOwner: Address;
  lastTransferSlot: bigint;
};

export async function fetchNftDisplayInfo(
  rpc: Rpc<SolanaRpcApi>,
  cardInstance: Address,
): Promise<NftDisplayInfo> {
  const mintContext = await resolveTransferMintContext(rpc, cardInstance);
  const instance = await parseCardInstanceAccount(rpc, cardInstance);
  const designMintData = await fetchAccountData(rpc, mintContext.designMint);
  const designExtensions = walkMintExtensions(designMintData);
  const designMeta = designExtensions.metadata;

  const groupMintData = await fetchAccountData(rpc, mintContext.groupMint);
  const groupExtensions = walkMintExtensions(groupMintData);
  const groupMeta = groupExtensions.metadata;

  const designJsonMeta = designMeta?.uri
    ? await fetchJsonMetadata(designMeta.uri)
    : null;
  const cardJsonMeta = instance.uri
    ? await fetchJsonMetadata(instance.uri)
    : null;

  return {
    cardInstance,
    designMint: mintContext.designMint,
    mint: mintContext.designMint,
    name: designMeta?.name ?? designJsonMeta?.name ?? "Unknown card",
    symbol: designMeta?.symbol ?? "",
    uri: designMeta?.uri ?? "",
    cardUri: instance.uri,
    image: designJsonMeta?.image ?? null,
    description: designJsonMeta?.description ?? null,
    attributes: parseCardAttributes(designJsonMeta?.attributes),
    credentialId: parseCredentialId(cardJsonMeta),
    expiry: parseExpiry(cardJsonMeta),
    collectionMint: mintContext.groupMint,
    collectionName: groupMeta?.name ?? null,
    currentOwner: instance.owner,
    lastTransferSlot: instance.lastTransferSlot,
  };
}
