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
  verification: ["startAuthentication", "verifyResponse"],
  assetLookup: [
    "findAssetPda",
    "fetchAllAssetsFromOwner",
    "fetchAssetsByPublicKey",
  ],
  generated: [
    "getInitializeInstruction",
    "getExecuteTransferInstruction",
    "getRemoveOwnershipInstruction",
    "getSetLockStateInstruction",
    "fetchAsset",
    "Asset",
    "AssetType",
  ],
  rustClient: "phygital-token-client (clients/rust/phygital-token)",
} as const;
