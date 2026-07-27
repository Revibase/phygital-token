export const SDK_SURFACE = {
  mint: [
    "buildCreateMintInstructions",
    "buildMintTokenInstructions",
    "parseSecp256r1Pubkey",
    "validateMetadataFields",
  ],
  transfer: [
    "beginTransfer",
    "authenticatePasskeyForTransfer",
    "completeTransfer",
  ],
  removeOwnership: ["getRemoveOwnershipInstructionAsync"],
  verifyAssetComposable: [
    "beginVerifyAsset",
    "authenticatePasskeyForVerifyAsset",
    "buildVerifyAssetArgs",
    "completeVerifyAsset",
  ],
  verification: [
    "verifyDynamicUrl",
    "verifyDynamicUrlWithoutCounterCheck",
    "startAuthentication",
    "verifyResponse",
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
    "fetchAllAssetsFromOwner",
    "fetchAssetDisplayInfoFromSecp256r1PublicKey",
    "fetchAssetDisplayInfo",
    "fetchShortcutsFromExternalUrl",
    "resolveMedia",
  ],
  generated: [
    "getMintTokenInstructionAsync",
    "getExecuteTransferInstructionAsync",
    "getVerifyAssetInstruction",
    "getSetLockStateInstruction",
    "getRemoveOwnershipInstructionAsync",
    "fetchAsset",
    "findProgramAuthorityPda",
    "PHYGITAL_TOKEN_PROGRAM_ADDRESS",
  ],
  rustClient: {
    crate: "phygital-token-client",
    path: "clients/rust/phygital-token",
    features: ["anchor", "fetch"],
    cpi: [
      "VerifyAssetCpi",
      "VerifyAssetCpiBuilder",
      "VerifyAssetInstructionArgs",
      "RemoveOwnershipCpi",
      "RemoveOwnershipCpiBuilder",
    ],
    types: ["Asset", "Secp256r1VerifyArgs", "AssetType"],
  },
} as const;
