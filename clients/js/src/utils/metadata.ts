import {
  address,
  getAddressDecoder,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  METADATA_KEY_ALLOWED_RECIPIENT,
  METADATA_KEY_DOMAIN_CONFIG,
  METADATA_KEY_PAYMENT_TOKEN_MINT,
  METADATA_KEY_PAYMENT_TOKEN_PROGRAM,
  METADATA_KEY_ROYALTY_BPS,
  METADATA_KEY_ROYALTY_OWNER,
  METADATA_KEY_SECP256R1,
  METADATA_KEY_TRANSFER_PRICE,
  TOKEN_GROUP_MEMBER_EXTENSION_TYPE,
  TOKEN_METADATA_EXTENSION_TYPE,
} from "./consts";
import { fetchDomainConfig } from "../generated";
import { fetchAccountData } from "./slotHash";

const MINT_ACCOUNT_SIZE = 82;

export type TransferMintContext = {
  tokenMint: Address;
  groupMint: Address;
  domainConfig: Address;
  groupOwner: Address;
  domainAuthority: Address;
  secp256r1Pubkey: Uint8Array;
  transferPrice: bigint;
  paymentTokenMint: Address | null;
  paymentTokenProgram: Address | null;
  allowedRecipient: Address | null;
  groupRoyaltyBps: number;
  domainRoyaltyBps: number;
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

function parseTokenMetadataExtension(
  data: Uint8Array,
): Map<string, string> {
  const fields = new Map<string, string>();
  let offset = 0;

  ({ offset } = readOptionalPubkey(data, offset));
  offset += 32;

  for (let i = 0; i < 3; i += 1) {
    const parsed = readBorshString(data, offset);
    offset = parsed.offset;
  }

  const additionalCount = readU32LE(data, offset);
  offset += 4;
  for (let i = 0; i < additionalCount; i += 1) {
    const key = readBorshString(data, offset);
    const value = readBorshString(data, key.offset);
    fields.set(key.value, value.value);
    offset = value.offset;
  }

  return fields;
}

function parseGroupMint(data: Uint8Array): Address {
  if (data.length < 64) {
    throw new Error("TokenGroupMember extension is too short");
  }
  return getAddressDecoder().decode(data.subarray(32, 64));
}

function walkMintExtensions(data: Uint8Array): {
  groupMint: Address | null;
  metadata: Map<string, string>;
} {
  let groupMint: Address | null = null;
  let metadata = new Map<string, string>();
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

function parseOptionalAddress(value: string | undefined): Address | null {
  if (!value || value.length === 0) {
    return null;
  }
  return address(value);
}

function parseTransferPrice(value: string | undefined): bigint {
  if (!value || value.length === 0) {
    return 0n;
  }
  return BigInt(value);
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

  const groupMintData = await fetchAccountData(rpc, tokenExtensions.groupMint);
  const groupExtensions = walkMintExtensions(groupMintData);

  const domainConfigValue =
    groupExtensions.metadata.get(METADATA_KEY_DOMAIN_CONFIG);
  if (!domainConfigValue) {
    throw new Error("Collection mint is missing domain config metadata");
  }

  const royaltyOwnerValue =
    groupExtensions.metadata.get(METADATA_KEY_ROYALTY_OWNER);
  if (!royaltyOwnerValue) {
    throw new Error("Collection mint is missing royalty owner metadata");
  }

  const royaltyBpsValue = groupExtensions.metadata.get(METADATA_KEY_ROYALTY_BPS);
  let groupRoyaltyBps = 0;
  if (royaltyBpsValue) {
    groupRoyaltyBps = Number.parseInt(royaltyBpsValue, 10);
    if (Number.isNaN(groupRoyaltyBps) || groupRoyaltyBps > 10_000) {
      throw new Error("Collection mint has invalid royalty bps metadata");
    }
  }

  const secp256r1Value = tokenExtensions.metadata.get(METADATA_KEY_SECP256R1);
  if (!secp256r1Value) {
    throw new Error("Token mint is missing secp256r1 passkey metadata");
  }

  const domainConfig = address(domainConfigValue);
  const domainConfigAccount = await fetchDomainConfig(rpc, domainConfig);

  return {
    tokenMint,
    groupMint: tokenExtensions.groupMint,
    domainConfig,
    groupOwner: address(royaltyOwnerValue),
    domainAuthority: domainConfigAccount.data.authority,
    secp256r1Pubkey: decodeSecp256r1Pubkey(secp256r1Value),
    transferPrice: parseTransferPrice(
      tokenExtensions.metadata.get(METADATA_KEY_TRANSFER_PRICE),
    ),
    paymentTokenMint: parseOptionalAddress(
      tokenExtensions.metadata.get(METADATA_KEY_PAYMENT_TOKEN_MINT),
    ),
    paymentTokenProgram: parseOptionalAddress(
      tokenExtensions.metadata.get(METADATA_KEY_PAYMENT_TOKEN_PROGRAM),
    ),
    allowedRecipient: parseOptionalAddress(
      tokenExtensions.metadata.get(METADATA_KEY_ALLOWED_RECIPIENT),
    ),
    groupRoyaltyBps,
    domainRoyaltyBps: domainConfigAccount.data.royaltyBps,
  };
}
