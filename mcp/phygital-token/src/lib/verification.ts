export type VerificationUseCase =
  | "login_ui_only"
  | "transfer_ownership"
  | "native_mobile_app"
  | "lookup_after_tap"
  | "onchain_cpi_verify";

export type VerificationRecommendation = {
  method: string;
  sdkExports: string[];
  requiresTap: boolean;
  onChain: boolean;
  rationale: string;
  docIds: string[];
  cautions?: string[];
};

const RECOMMENDATIONS: Record<VerificationUseCase, VerificationRecommendation> = {
  login_ui_only: {
    method: "authentication — startAuthentication + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Server issues challenge; client taps NFC via startAuthentication(message, rpc); server verifies with verifyResponse. No on-chain transaction. Browser path requires Kit Rpc for placeholder credential-id recovery.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: [
      "Run verifyResponse on your server, not in the browser.",
      "Pass Kit Rpc to startAuthentication even when using transceive (rpc is unused on the native path).",
    ],
  },
  transfer_ownership: {
    method: "transfer — beginTransfer / completeTransfer",
    sdkExports: ["beginTransfer", "authenticatePasskeyForTransfer", "completeTransfer"],
    requiresTap: true,
    onChain: true,
    rationale:
      "Ownership claim uses transfer_ownership (updates phygital_token.owner; no SPL token). beginTransfer takes secp256r1Pubkey and derives the token PDA.",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: [
      "Do not use verifyResponse alone for transfers — it does not change on-chain ownership.",
      "Do not use verify for transfers — it proves possession without changing owner.",
      "Recipient must sign the transaction — pass completeTransfer a Kit TransactionSigner.",
    ],
  },
  native_mobile_app: {
    method: "authentication — startAuthentication (transceive) + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive in startAuthentication options for native NFC readers; verify on server. Rpc is still required but unused when transceive is set.",
    docIds: ["verification:methods", "verification:verify-composable"],
    cautions: ["Run verifyResponse on your server, not in the native client."],
  },
  lookup_after_tap: {
    method: "verifyResponse → findPhygitalTokenPda + fetchPhygitalToken",
    sdkExports: ["verifyResponse", "findPhygitalTokenPda", "fetchPhygitalToken"],
    requiresTap: true,
    onChain: false,
    rationale:
      "After verifyResponse, derive the token PDA from the passkey public key and fetch the account. Chip identifier is a binding field on the token, not the PDA seed.",
    docIds: ["verification:methods", "sdk:surface-area"],
  },
  onchain_cpi_verify: {
    method: "on-chain verify — your program CPIs verify",
    sdkExports: [
      "buildMessageHash",
      "authenticatePasskeyForSecp256r1Verify",
      "buildSecp256r1VerifyInstruction",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Client prepends secp256r1_verify and passes phygitalTokenPda + secp256r1VerifyArgs into your instruction. Tap requires rpc. Your program CPIs verify with VerifyCpiBuilder.",
    docIds: [
      "verification:verify-composable",
      "building-on-phygital:rust-cpi",
    ],
  },
};

export function recommendVerification(
  useCase: VerificationUseCase,
): VerificationRecommendation {
  return RECOMMENDATIONS[useCase];
}

export function listVerificationUseCases(): Array<{
  id: VerificationUseCase;
  summary: string;
}> {
  return [
    { id: "login_ui_only", summary: "Off-chain tap-to-login (no chain tx)" },
    { id: "transfer_ownership", summary: "Claim/transfer ownership to a new wallet" },
    { id: "native_mobile_app", summary: "Native app off-chain authentication" },
    { id: "lookup_after_tap", summary: "Verify tap then load on-chain token state" },
    {
      id: "onchain_cpi_verify",
      summary: "On-chain proof: your program CPIs verify",
    },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Authentication (live NFC tap required)
├── Need on-chain ownership change?
│   YES → beginTransfer({ rpc, secp256r1Pubkey }) → completeTransfer (transfer_ownership)
│   NO  → Need on-chain possession proof for your program?
│         YES → buildMessageHash(message)
│               → authenticatePasskeyForSecp256r1Verify({ rpc, messageHash })
│               → buildSecp256r1VerifyInstruction(tap)
│               [secp256r1_verify, your_program_instruction] — program CPIs verify
│         NO  → startAuthentication(message, rpc) (client tap)
│               → verifyResponse (server verify)
│               → optional: findPhygitalTokenPda(secp256r1PublicKey) / fetchPhygitalToken
└── Know the passkey already?
    → findPhygitalTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)

WebAuthn credential id:
- rawId 33 bytes → authenticator returned the passkey public key
- rawId 16 bytes → platform echoed random placeholder; SDK recovers from signature
- ambiguous recovery → pick candidate with initialized PhygitalToken PDA on-chain

Browser WebAuthn requires Kit Rpc on all tap helpers.
verifyResponse never submits verify. Run it on your server.
Token PDA is seeded by the passkey public key; chip identifier is a separate binding field.
Optional expected_rp_id / expected_origins are set on VerifyCpiBuilder (omit to skip).
PDA is derived after the NFC tap. Your program always CPIs verify — do not post a client-side verify instruction.
`.trim();
