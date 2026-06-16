import {
  unwrapOption,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  fetchMint,
  isExtension,
  type Extension,
} from "@solana-program/token-2022";
import { fetchCardInstance } from "../generated";
import {
  findCardInstancePda,
  parseSecp256r1Pubkey,
} from "../instructions/mint";
import { RP_ID } from "./consts";


export const DEFAULT_VERIFY_METADATA_ENDPOINT = `https://${RP_ID}/api/metadata`;

export type VerifyMetadataResult = {
  publicKey: string;
  isVerified:boolean;
};

export type VerifyMetadataCallback = (
  params: URLSearchParams,
) => Promise<VerifyMetadataResult>;

function findMintExtension(
  extensions: readonly Extension[],
  kind: "TokenMetadata",
): Extract<Extension, { __kind: "TokenMetadata" }> | null;
function findMintExtension(
  extensions: readonly Extension[],
  kind: "TokenGroupMember",
): Extract<Extension, { __kind: "TokenGroupMember" }> | null;
function findMintExtension(
  extensions: readonly Extension[],
  kind: Extension["__kind"],
): Extension | null {
  for (const extension of extensions) {
    if (isExtension(kind, extension)) {
      return extension;
    }
  }
  return null;
}

type CardAttribute = {
  traitType: string;
  value: string;
};

export type TokenJsonMetadata = {
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  /** Design mint public key this card instance belongs to. */
  mint?: string;
  attributes?: Array<{
    trait_type?: string;
    traitType?: string;
    value?: string | number;
  }>;
};

function parseCardAttributes(
  raw: TokenJsonMetadata["attributes"],
): CardAttribute[] {
  if (!raw?.length) {
    return [];
  }

  return raw
    .map((attribute) => {
      const traitType = attribute.trait_type ?? attribute.traitType;
      if (
        !traitType ||
        attribute.value === undefined ||
        attribute.value === null
      ) {
        return null;
      }
      return {
        traitType,
        value: String(attribute.value),
      };
    })
    .filter((attribute): attribute is CardAttribute => attribute !== null);
}

export async function verifyMetadata(
  uri: string,
  params: URLSearchParams,
): Promise<VerifyMetadataResult> {
  try {
    const url = new URL(uri);
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(`${url.toString()}`);
    if (!response.ok) {
      const error = (await response.json()) as { error: string };
      throw new Error(error.error);
    }
    return (await response.json()) as VerifyMetadataResult;
  } catch (error) {
    throw error;
  }
}

async function fetchJsonMetadata(
  uri: string,
): Promise<TokenJsonMetadata | null> {
  if (!uri) {
    return null;
  }
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as TokenJsonMetadata;
  } catch {
    return null;
  }
}

export type NftDisplayInfo = {
  /** Card instance PDA — unique per physical card. */
  cardInstance: Address;
  /** Shared design mint (SFT). */
  mint: Address;
  name: string;
  symbol: string;
  /** Design metadata URI (shared visual/name info). */
  uri: string;
  image: string | null;
  description: string | null;
  attributes: CardAttribute[];
  /** Collection Details. */
  collectionMint: Address | null;
  collectionName: string | null;
  collectionSymbol: string | null;
  collectionImage: string | null;
  collectionUri: string | null;
  currentOwner: Address;
  lastTransferSlot: bigint;
};

export async function fetchNftDisplayInfo(
  rpc: Rpc<SolanaRpcApi>,
  lookupKey: string,
): Promise<NftDisplayInfo> {
  const  cardInstance  = await findCardInstancePda(parseSecp256r1Pubkey(lookupKey));
  const instance = await fetchCardInstance(rpc, cardInstance);

  const mintAccount = await fetchMint(rpc, instance.data.mint);
  const designExtensions = unwrapOption(mintAccount.data.extensions) ?? [];
  const designMeta = findMintExtension(designExtensions, "TokenMetadata");
  const groupMember = findMintExtension(designExtensions, "TokenGroupMember");
  const collectionMint = groupMember?.group ?? null;

  let collectionMeta: Extract<Extension, { __kind: "TokenMetadata" }> | null =
    null;
  if (collectionMint) {
    const collectionMintAccount = await fetchMint(rpc, collectionMint);
    const collectionExtensions =
      unwrapOption(collectionMintAccount.data.extensions) ?? [];
    collectionMeta = findMintExtension(collectionExtensions, "TokenMetadata");
  }

  const [designJsonMeta, collectionJsonMeta] = await Promise.all([
    designMeta?.uri ? fetchJsonMetadata(designMeta.uri) : Promise.resolve(null),
    collectionMeta?.uri
      ? fetchJsonMetadata(collectionMeta.uri)
      : Promise.resolve(null),
  ]);

  return {
    cardInstance,
    mint: instance.data.mint,
    name: designMeta?.name ?? designJsonMeta?.name ?? "Unknown card",
    symbol: designMeta?.symbol ?? designJsonMeta?.symbol ?? "",
    uri: designMeta?.uri ?? "",
    image: designJsonMeta?.image ?? null,
    description: designJsonMeta?.description ?? null,
    attributes: parseCardAttributes(designJsonMeta?.attributes),
    collectionMint,
    collectionName: collectionMeta?.name ?? collectionJsonMeta?.name ?? null,
    collectionSymbol:
      collectionMeta?.symbol ?? collectionJsonMeta?.symbol ?? null,
    collectionImage: collectionJsonMeta?.image ?? null,
    collectionUri: collectionMeta?.uri ?? null,
    currentOwner: instance.data.owner,
    lastTransferSlot: instance.data.lastTransferSlot,
  };
}
