export const SDK_SURFACE = {
  initialize: [
    "buildInitializeInstruction",
    "parseSecp256r1Pubkey",
    "parseIdentifier",
  ],
  transfer: [
    "beginTransfer",
    "authenticatePasskeyForTransfer",
    "completeTransfer",
  ],
  removeOwnership: ["getRemoveOwnershipInstruction"],
  verifyAssetComposable: [
    "beginVerifyAsset",
    "authenticatePasskeyForVerifyAsset",
    "buildVerifyAssetArgs",
    "completeVerifyAsset",
  ],
  verification: ["startAuthentication", "verifyResponse"],
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
    "fetchAllAssetsFromOwner",
    "fetchAssetsByPublicKey",
  ],
  generated: [
    "getInitializeInstruction",
    "getExecuteTransferInstruction",
    "getVerifyAssetInstruction",
    "getRemoveOwnershipInstruction",
    "getSetLockStateInstruction",
    "fetchAsset",
    "Asset",
    "AssetType",
  ],
  rustClient: {
    crate: "phygital-token-client",
    path: "clients/rust/phygital-token",
    cpi: [
      "VerifyAssetCpi",
      "VerifyAssetCpiBuilder",
      "VerifyAssetInstructionArgs",
      "ExecuteTransferCpi",
      "ExecuteTransferCpiBuilder",
      "RemoveOwnershipCpi",
      "RemoveOwnershipCpiBuilder",
    ],
    types: ["Asset", "Secp256r1VerifyArgs", "AssetType"],
  },
} as const;
