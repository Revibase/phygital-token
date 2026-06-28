import { readFile } from "node:fs/promises";
import {
  pathExists,
  resolveRustVerifyAssetPath,
  resolveVerifyAssetTsPath,
  resolveVerifyTsPath,
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
    "startAuthenticationWithChallengeResponse",
    "verifyWithChallengeResponse",
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
    "Gating",
    "GatingTraitValue",
    "formatGatingPredicate",
    "summarizeGatingEvaluationFailure",
    "summarizeGatingFailure",
    "summarizeGatingTierFailure",
    "evaluateAssetGating",
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
    "verify.ts": resolveVerifyTsPath(),
    "verifyAsset.ts": resolveVerifyAssetTsPath(),
    "rust_verify_asset.rs": resolveRustVerifyAssetPath(),
  };

  const filePath = paths[which];
  if (!(await pathExists(filePath))) {
    throw new Error(
      `Source file not found: ${filePath}. Set PHYGITAL_TOKEN_REPO_ROOT to a cloned phygital-token repo to use read_sdk_source.`,
    );
  }

  const content = await readFile(filePath, "utf8");
  const lines = content.split("\n").slice(0, maxLines);

  return {
    path: filePath,
    excerpt: lines.join("\n") + (content.split("\n").length > maxLines ? "\n// ..." : ""),
  };
}
