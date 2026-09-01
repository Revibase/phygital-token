export const SDK_SURFACE = {
  webAuthn: {
    credentialId: "33 bytes = authenticator passkey; 16 bytes = platform echoed placeholder (recovery runs)",
    rpcRequired:
      "Kit Rpc required on all browser WebAuthn taps (startAuthentication, authenticatePasskeyForSecp256r1Verify, authenticatePasskeyForTransfer)",
    recovery:
      "When multiple keys verify, disambiguates via initialized PhygitalToken PDA on-chain",
  },
  initialize: [
    "getInitializeInstruction",
    "findPhygitalTokenPda",
    "parseSecp256r1Pubkey",
    "ADMIN",
    "INITIALIZE_MULTISIG_PDA",
  ],
  setMint: [
    "getSetMintInstruction",
    "findPhygitalTokenPda",
  ],
  transfer: [
    "beginTransfer({ rpc, secp256r1Pubkey, rpId? })",
    "authenticatePasskeyForTransfer",
    "completeTransfer",
  ],
  removeOwnership: ["getRemoveOwnershipInstruction"],
  verifyComposable: [
    "buildMessageHash",
    "authenticatePasskeyForSecp256r1Verify({ rpc, messageHash, rpId? })",
    "buildSecp256r1VerifyInstruction",
  ],
  verification: [
    "startAuthentication(message, rpc, options?)",
    "verifyResponse",
  ],
  onChainComposition: {
    client: [
      "buildMessageHash",
      "authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })",
      "buildSecp256r1VerifyInstruction",
    ],
    transaction: ["secp256r1_verify", "your_program_instruction"],
    program: "CPI verify via VerifyCpiBuilder",
    optionalBindings: {
      expected_rp_id: "Option<String> — omit to skip; SHA256(rpId) must match authenticatorData[0..32]",
      expected_origins: "Option<Vec<String>> — omit to skip; when set, clientDataJSON.origin must match one entry",
    },
  },
  tokenLookup: [
    "findPhygitalTokenPda",
    "fetchPhygitalTokensByOwner",
    "fetchPhygitalTokenByIdentifier",
    "fetchPhygitalTokenByMint",
  ],
  web3js: [
    "toRpc",
    "toAddress",
    "toTransactionSigner",
    "toWeb3Instruction",
    "toWeb3Instructions",
  ],
  generated: [
    "getInitializeInstruction",
    "getTransferOwnershipInstruction",
    "getVerifyInstruction",
    "getRemoveOwnershipInstruction",
    "getSetLockStateInstruction",
    "getSetMintInstruction",
    "fetchPhygitalToken",
    "PhygitalToken",
    "PhygitalTokenType",
  ],
  rustClient: {
    crate: "phygital-token-client",
    path: "clients/rust/phygital-token",
    cpi: [
      "VerifyCpi",
      "VerifyCpiBuilder",
      "VerifyInstructionArgs",
      "SetMintCpi",
      "SetMintCpiBuilder",
      "TransferOwnershipCpi",
      "TransferOwnershipCpiBuilder",
      "RemoveOwnershipCpi",
      "RemoveOwnershipCpiBuilder",
    ],
    types: ["PhygitalToken", "Secp256r1VerifyArgs", "PhygitalTokenType"],
  },
} as const;
