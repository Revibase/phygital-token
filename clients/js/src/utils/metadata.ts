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
import { parseSecp256r1Pubkey } from "../instructions/mint.js";
import { findAssetPda } from "./pdas/asset.js";
import { AssetType, fetchAsset } from "../generated/index.js";
import { bufferToBase64URLString } from "@simplewebauthn/browser";

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

type AssetAttribute = {
  trait_type?: string;
  traitType?: string;
  value?: string | number;
};

/**
 * A wallet action shortcut embedded in the off-chain metadata
 * (Phantom Shortcuts schema v2). Rendered as an action button on the card.
 */
export type Shortcut = {
  label?: string;
  uri?: string;
  icon?: string;
  type?: string;
};

/** Phantom collectible media categories (Metaplex `properties.category`). */
export type MediaCategory = "image" | "video" | "audio" | "vr";

/** A single asset referenced from `properties.files` in the off-chain JSON. */
export type TokenMediaFile = {
  uri?: string;
  /** MIME type, e.g. "image/png", "video/mp4", "model/gltf-binary". */
  type?: string;
  /** Served through a CDN — Phantom prefers these when selecting media. */
  cdn?: boolean;
};

export type TokenJsonMetadata = {
  name?: string;
  symbol?: string;
  image?: string;
  description?: string;
  /** Primary animated/interactive asset (video/audio/3D) — Phantom's top media pick. */
  animation_url?: string;
  external_url?: string;
  /** Design mint public key this asset instance belongs to. */
  mint?: string;
  attributes?: Array<AssetAttribute>;
  properties?: {
    category?: MediaCategory | string;
    files?: TokenMediaFile[];
  };
  /** Embedded Phantom Shortcuts (schema v2): `{ version, shortcuts }`. */
  shortcuts?: Array<Shortcut>;
};

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};

/** Best-effort MIME type for a media URI, inferred from its path extension. */
function mimeFromUri(uri: string): string | null {
  const clean = uri.split("?")[0].split("#")[0];
  const ext = clean.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPE_BY_EXT[ext] ?? null;
}

/** Map a MIME type to the Phantom collectible category it renders as. */
function categoryForMime(
  type: string | undefined | null,
): MediaCategory | null {
  if (!type) return null;
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("model/")) return "vr";
  if (type.startsWith("image/")) return "image";
  return null;
}

export type ResolvedMedia = {
  /** Still image / poster — Phantom resizes this to 256×256. */
  image: string | null;
  /** Animated/interactive asset (video/audio/3D), if any. */
  animationUrl: string | null;
  /** MIME type of `animationUrl`. */
  animationType: string | null;
  /** The collectible's primary media category. */
  category: MediaCategory | null;
};

/**
 * Resolve which media to display from an off-chain Token-Metadata JSON,
 * following Phantom's collectible-rendering spec: `animation_url` is the top
 * pick, then the first non-image entry in `properties.files`; `image` (or the
 * first image file) is the still/poster. Mirrors how Phantom itself selects
 * media so the in-app card matches the wallet.
 */
export function resolveMedia(json: TokenJsonMetadata | null): ResolvedMedia {
  if (!json) {
    return {
      image: null,
      animationUrl: null,
      animationType: null,
      category: null,
    };
  }

  const files = json.properties?.files ?? [];
  const image =
    json.image ??
    files.find((f) => f.uri && categoryForMime(f.type) === "image")?.uri ??
    null;

  let animationUrl = json.animation_url ?? null;
  let animationType: string | null = null;
  if (animationUrl) {
    animationType =
      files.find((f) => f.uri === animationUrl)?.type ??
      mimeFromUri(animationUrl);
  } else {
    // No animation_url: fall back to the first audio/video/3D file, preferring
    // CDN-served entries (Phantom's tie-breaker).
    const ranked = [...files].sort(
      (a, b) => Number(Boolean(b.cdn)) - Number(Boolean(a.cdn)),
    );
    const media = ranked.find((f) => {
      const c = categoryForMime(f.type ?? mimeFromUri(f.uri ?? ""));
      return f.uri && (c === "video" || c === "audio" || c === "vr");
    });
    if (media?.uri) {
      animationUrl = media.uri;
      animationType = media.type ?? mimeFromUri(media.uri);
    }
  }

  const rawCategory = json.properties?.category;
  const declaredCategory =
    rawCategory && ["image", "video", "audio", "vr"].includes(rawCategory)
      ? (rawCategory as MediaCategory)
      : null;
  const category =
    declaredCategory ??
    categoryForMime(animationType) ??
    (image ? "image" : null);

  return { image, animationUrl, animationType, category };
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

export type AssetDisplayInfo = {
  assetType: AssetType;
  publicKey: string;
  credentialId: string;
  asset: Address;
  isLocked: boolean;
  mint: Address;
  name: string;
  symbol: string;
  uri: string;
  image: string | null;
  animationUrl: string | null;
  animationType: string | null;
  mediaCategory: MediaCategory | null;
  description: string | null;
  attributes: AssetAttribute[];
  /** Wallet action shortcuts embedded in the off-chain metadata. */
  shortcuts: Shortcut[];
  collectionMint: Address | null;
  collectionName: string | null;
  collectionSymbol: string | null;
  collectionImage: string | null;
  collectionUri: string | null;
  currentOwner: Address;
  lastTransferSlot: bigint;
};

export async function fetchAssetDisplayInfo(
  rpc: Rpc<SolanaRpcApi>,
  publicKey: string,
): Promise<AssetDisplayInfo> {
  const asset = await findAssetPda(parseSecp256r1Pubkey(publicKey));
  const instance = await fetchAsset(rpc, asset);

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

  const designMedia = resolveMedia(designJsonMeta);

  return {
    assetType: instance.data.assetType,
    publicKey,
    credentialId: bufferToBase64URLString(
      instance.data.credentialId[0].buffer as ArrayBuffer,
    ),
    asset: asset,
    isLocked: instance.data.isLocked,
    mint: instance.data.mint,
    name: designMeta?.name ?? designJsonMeta?.name ?? "Unknown asset",
    symbol: designMeta?.symbol ?? designJsonMeta?.symbol ?? "",
    uri: designMeta?.uri ?? "",
    image: designMedia.image,
    animationUrl: designMedia.animationUrl,
    animationType: designMedia.animationType,
    mediaCategory: designMedia.category,
    description: designJsonMeta?.description ?? null,
    attributes: designJsonMeta?.attributes ?? [],
    shortcuts: designJsonMeta?.shortcuts ?? [],
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
