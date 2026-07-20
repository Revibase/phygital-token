export {
  beginTransfer,
  completeTransfer,
  authenticatePasskeyForTransfer,
  type TransferSession,
} from "./instructions/transfer.js";

export {
  beginVerifyAsset,
  completeVerifyAsset,
  buildVerifyAssetArgs,
  authenticatePasskeyForVerifyAsset,
  type VerifyAssetSession,
} from "./instructions/verifyAsset.js";

export {
  buildCreateMintInstructions,
  buildMintTokenInstructions,
  parseSecp256r1Pubkey,
  parseCredentialId,
  validateMetadataFields,
  type MetadataFields,
} from "./instructions/mint.js";

export {
  fetchAssetDisplayInfo,
  fetchShortcutsFromExternalUrl,
  resolveMedia,
  type AssetDisplayInfo,
  type MediaCategory,
  type ResolvedMedia,
  type Shortcut,
  type ShortcutsDocument,
  type TokenJsonMetadata,
  type TokenMediaFile,
} from "./utils/metadata.js";

export {
  fetchAssetFromCredentialId,
  fetchAllAssetsFromOwner,
} from "./utils/assetCredential.js";

export {
  verifyDynamicUrl,
  verifyDynamicUrlWithoutCounterCheck,
  startAuthenticationWithChallengeResponse,
  verifyWithChallengeResponse,
  type VerifyDynamicUrlCallback,
  type VerifyDynamicUrlResult,
  type VerifyWithChallengeResponseResult,
  type VerifyWithChallengeResponseOptions,
  type GetPublicKeyFromCredentialIdCallback,
} from "./utils/verify.js";

export { findAssetPda } from "./utils/pdas/index.js";

export {
  evaluateAssetGating,
  evaluateGatingTiers,
  evaluateGatingFilter,
  assetMatchesPredicate,
  Gating,
  GatingTraitValue,
  formatGatingPredicate,
  summarizeGatingEvaluationFailure,
  summarizeGatingFailure,
  summarizeGatingTierFailure,
  type EvaluateAssetGatingOptions,
  type GatingAssetPredicate,
  type GatingEvaluationResult,
  type GatingFilter,
  type GatingFilterResult,
  type GatingTier,
  type GatingTierEvaluationResult,
  type GatingTiersEvaluationResult,
} from "./utils/gating.js";

export * from "./generated/index.js";

export {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
  type Secp256r1VerifyInstruction,
} from "./instructions/internal/secp256r1Verify.js";

export {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildVerifyAssetChallenge,
  buildTransferChallenge,
  buildVerifyInputFromWebAuthn,
  type WebAuthnSecp256r1Verification,
} from "./utils/passkey/secp256r1.js";
