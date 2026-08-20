export type VerificationUseCase =
  | "login_ui_only"
  | "transfer_ownership"
  | "native_mobile_app"
  | "lookup_after_tap"
  | "onchain_standalone_verify"
  | "onchain_inspect_verify_asset"
  | "onchain_cpi_verify_asset";

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
      "Server issues challenge; client taps NFC via startAuthentication; server verifies with verifyResponse. No on-chain transaction.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: ["Run verifyResponse on your server, not in the browser."],
  },
  transfer_ownership: {
    method: "transfer — beginTransfer / completeTransfer",
    sdkExports: ["beginTransfer", "authenticatePasskeyForTransfer", "completeTransfer"],
    requiresTap: true,
    onChain: true,
    rationale: "Ownership claim uses transfer_ownership (updates token.owner; no SPL token).",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: [
      "Do not use verifyResponse alone for transfers — it does not change on-chain ownership.",
      "Do not use verify for transfers — it proves possession without changing owner.",
      "Recipient must sign the transaction — pass completeTransfer a TransactionSigner, not just an address.",
    ],
  },
  native_mobile_app: {
    method: "authentication — startAuthentication (transceive) + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive to startAuthentication for native NFC readers; verify on server. Use beginVerify for on-chain proof, beginTransfer for ownership changes.",
    docIds: ["verification:methods", "verification:verify-composable"],
    cautions: ["Run verifyResponse on your server, not in the native client."],
  },
  lookup_after_tap: {
    method: "verifyResponse → findTokenPda + fetchPhygitalToken",
    sdkExports: ["verifyResponse", "findTokenPda", "fetchPhygitalToken", "parseSecp256r1Pubkey"],
    requiresTap: true,
    onChain: false,
    rationale:
      "After verifyResponse, derive the token PDA from the passkey public key and fetch the account. Chip identifier is a binding field on the token, not the PDA seed.",
    docIds: ["verification:methods", "sdk:surface-area"],
  },
  onchain_standalone_verify: {
    method: "on-chain verify only",
    sdkExports: [
      "beginVerify",
      "authenticatePasskeyForVerify",
      "completeVerify",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Publish a possession proof on-chain without a custom program. Updates last_sign_count; does not change owner.",
    docIds: [
      "verification:verify-composable",
      "building-on-phygital:rust-cpi",
    ],
  },
  onchain_inspect_verify_asset: {
    method: "Pattern A — client posts verify, your program inspects message",
    sdkExports: [
      "beginVerify",
      "authenticatePasskeyForVerify",
      "completeVerify",
      "getVerifyInstruction",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Client includes verify in the tx. Your program scans instructions sysvar for that verify and validates message bytes.",
    docIds: [
      "verification:verify-composable",
      "building-on-phygital:rust-cpi",
    ],
  },
  onchain_cpi_verify_asset: {
    method: "Pattern B — buildVerifyArgs, your program CPIs verify",
    sdkExports: [
      "beginVerify",
      "authenticatePasskeyForVerify",
      "buildVerifyArgs",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Client includes secp256r1_verify + your ix only. Your program CPIs verify using args from buildVerifyArgs.",
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
    { id: "onchain_standalone_verify", summary: "On-chain verify only" },
    {
      id: "onchain_inspect_verify_asset",
      summary: "Pattern A: client posts verify, your program inspects message",
    },
    {
      id: "onchain_cpi_verify_asset",
      summary: "Pattern B: buildVerifyArgs, your program CPIs verify",
    },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Authentication (live NFC tap required)
├── Need on-chain ownership change?
│   YES → beginTransfer → completeTransfer (transfer_ownership)
│   NO  → Need on-chain possession proof for your program?
│         YES → beginVerify composable flow:
│               Pattern A: [secp256r1_verify, verify, your_ix] — program inspects sysvar
│               Pattern B: [secp256r1_verify, your_ix] — program CPIs verify
│         NO  → startAuthentication (client tap)
│               → verifyResponse (server verify)
│               → optional: findTokenPda(secp256r1PublicKey) / fetchPhygitalToken
└── Know the passkey already?
    → findTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)

verifyResponse never submits verify. Returns { isVerified, secp256r1PublicKey }
(response.id is the secp256r1 vault key / WebAuthn credential id). Run it on your server.
Token PDA is seeded by the passkey public key; chip identifier is a separate binding field.
On-chain proof always uses beginVerify({ messageHash }); PDA is derived after the NFC tap.
`.trim();
