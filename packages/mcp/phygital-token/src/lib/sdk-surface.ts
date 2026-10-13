export const SDK_SURFACE = {
  webAuthn: {
    credentialId:
      "33 bytes = authenticator passkey; 16 bytes = platform echoed placeholder (recovery runs)",
    allowList:
      "Set of base64url compressed public keys. When passed, the tapped credential id must always be in it (else PASSKEY_NOT_RECOGNIZED); it is also the no-RPC fallback for recovering a placeholder id when rpc is omitted. authenticatePasskeyForTransfer derives it from the session",
    recovery:
      "When multiple keys verify, picks the initialized PhygitalToken PDA on-chain (rpc), or the one in allowList when no rpc is given",
    authenticatePasskey:
      "Shared browser WebAuthn helper. Used by startAuthentication, authenticatePasskeyForTransfer and the accessory wallet.",
  },
  admin: [
    "getCreateConfigInstruction",
    "getSetAdminInstruction",
    "getSetIssuerInstruction",
    "getSetMinterInstruction",
    "getClosePhygitalTokenInstruction",
    "findAdminConfigPda",
  ],
  initialize: [
    "getInitializeInstruction",
    "findPhygitalTokenPda",
    "findAdminConfigPda",
    "parseSecp256r1Pubkey",
  ],
  assignMint: ["getAssignMintInstruction", "findPhygitalTokenPda", "findAdminConfigPda"],
  transfer: [
    "beginTransfer({ rpc, secp256r1Pubkey, recipient, rpId? })",
    "authenticatePasskeyForTransfer(session)",
    "completeTransfer",
  ],
  removeOwner: ["getRemoveOwnerInstruction"],
  verification: [
    "startAuthentication(message, { rpc?, allowList?, rpId? })",
    "verifyResponse({ expectedMessage, expectedOrigin, response })",
  ],
  tokenLookup: [
    "findPhygitalTokenPda",
    "findAdminConfigPda",
    "fetchPhygitalTokensByOwner",
    "fetchPhygitalTokenByIdentifier",
    "fetchPhygitalTokenByMint",
  ],
  generated: [
    "getInitializeInstruction",
    "getAssignMintInstruction",
    "getSetOwnerInstruction",
    "getRemoveOwnerInstruction",
    "getCreateConfigInstruction",
    "getSetAdminInstruction",
    "getSetIssuerInstruction",
    "getSetMinterInstruction",
    "getClosePhygitalTokenInstruction",
    "fetchPhygitalToken",
    "fetchAdminConfig",
    "findAdminConfigPda",
    "PhygitalToken",
    "AdminConfig",
    "PhygitalTokenType",
  ],
  rustClient: {
    crate: "phygital-token-client",
    path: "packages/rust/phygital-token",
    cpi: [
      "ClosePhygitalTokenCpi",
      "ClosePhygitalTokenCpiBuilder",
      "AssignMintCpi",
      "AssignMintCpiBuilder",
      "SetOwnerCpi",
      "SetOwnerCpiBuilder",
      "RemoveOwnerCpi",
      "RemoveOwnerCpiBuilder",
      "CreateConfigCpi",
      "CreateConfigCpiBuilder",
      "SetIssuerCpi",
      "SetIssuerCpiBuilder",
      "SetMinterCpi",
      "SetMinterCpiBuilder",
    ],
    types: ["PhygitalToken", "AdminConfig", "Secp256r1VerifyArgs", "PhygitalTokenType"],
    roles: {
      admin:
        "sole AdminConfig.admin — create_config signer; set_admin / set_issuer / set_minter / close_phygital_token",
      issuer: "sole AdminConfig.issuer — may call initialize",
      minter: "sole AdminConfig.minter — may call assign_mint",
    },
    tokenTypes: {
      Permanent:
        "discriminant 0 — owner required at init; starts locked; set_owner / remove rejected",
      Bearer: "freely transferable by passkey when unlocked; initialized with no owner",
      Controlled: "lock after claim; forfeit via remove_owner before next transfer",
    },
  },
} as const;
