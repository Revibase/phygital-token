import { readFile } from "node:fs/promises";
import {
  RUST_CLIENT_VERIFY_ASSET_PATH,
  VERIFY_ASSET_TS_PATH,
  VERIFY_TS_PATH,
  pathExists,
} from "./paths.js";

export const SDK_SURFACE = {
  mint: [
    "buildCreateMintInstructions",
    "buildMintTokenInstructions",
    "parseSecp256r1Pubkey",
    "parseCredentialId",
    "validateMetadataFields",
  ],
  transfer: [
    "beginTransfer",
    "authenticatePasskeyForTransfer",
    "completeTransfer",
  ],
  verifyAssetComposable: [
    "beginVerifyAsset",
    "authenticatePasskeyForVerifyAsset",
    "buildVerifyAssetArgs",
    "completeVerifyAsset",
  ],
  verification: [
    "verifyDynamicUrl",
    "verifyDynamicUrlWithoutCounterCheck",
    "verifyWithChallengeResponse",
    "verifyWithChallengeResponseOverNfc",
  ],
  onChainComposition: {
    patternA_inspect: {
      client: ["beginVerifyAsset", "completeVerifyAsset"],
      transaction: ["secp256r1_verify", "verify_asset", "your_program_ix"],
      program: "inspect instructions sysvar for verify_asset message",
    },
    patternB_cpi: {
      client: ["beginVerifyAsset", "buildVerifyAssetArgs"],
      transaction: ["secp256r1_verify", "your_program_ix"],
      program: "CPI verify_asset via VerifyAssetCpiBuilder",
    },
  },
  assetLookup: [
    "findAssetPda",
    "fetchAssetFromCredentialId",
    "fetchAllAssetsFromOwner",
    "fetchAssetDisplayInfo",
    "resolveMedia",
  ],
  gating: [
    "evaluateAssetGating",
    "evaluateGatingTiers",
    "evaluateGatingFilter",
    "assetMatchesPredicate",
    "Gating",
    "GatingTraitValue",
    "formatGatingPredicate",
    "summarizeGatingEvaluationFailure",
    "summarizeGatingFailure",
    "summarizeGatingTierFailure",
  ],
  gatingTypes: [
    "EvaluateAssetGatingOptions",
    "GatingFilter",
    "GatingAssetPredicate",
    "GatingTier",
    "GatingEvaluationResult",
    "GatingFilterResult",
    "GatingTierEvaluationResult",
    "GatingTiersEvaluationResult",
  ],
  generated: [
    "getCreateMintInstructionAsync",
    "getMintTokenInstructionAsync",
    "getExecuteTransferInstructionAsync",
    "getVerifyAssetInstruction",
    "getSetLockStateInstruction",
    "fetchAsset",
    "findProgramAuthorityPda",
    "PHYGITAL_TOKEN_PROGRAM_ADDRESS",
  ],
  rustClient: {
    crate: "phygital-token-client",
    path: "clients/rust/phygital-token",
    features: ["anchor", "fetch"],
    cpi: ["VerifyAssetCpi", "VerifyAssetCpiBuilder", "VerifyAssetInstructionArgs"],
    types: ["Asset", "Secp256r1VerifyArgs", "AssetType"],
  },
} as const;

export async function readSourceExcerpt(
  which: "verify.ts" | "verifyAsset.ts" | "rust_verify_asset.rs",
  maxLines = 120,
): Promise<{ path: string; excerpt: string }> {
  const paths = {
    "verify.ts": VERIFY_TS_PATH,
    "verifyAsset.ts": VERIFY_ASSET_TS_PATH,
    "rust_verify_asset.rs": RUST_CLIENT_VERIFY_ASSET_PATH,
  };

  const filePath = paths[which];
  if (!(await pathExists(filePath))) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").slice(0, maxLines);

  return {
    path: filePath,
    excerpt: lines.join("\n") + (content.split("\n").length > maxLines ? "\n// ..." : ""),
  };
}
