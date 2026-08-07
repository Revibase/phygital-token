export type VerificationUseCase =
  | "login_ui_only"
  | "transfer_ownership"
  | "native_mobile_app"
  | "lookup_after_tap";

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
    rationale: "Ownership claim uses execute_transfer (updates asset.owner; no SPL token).",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: ["Do not use verifyResponse alone for transfers — it does not change on-chain ownership."],
  },
  native_mobile_app: {
    method: "authentication — startAuthentication (transceive) + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive to startAuthentication for native NFC readers; verify on server. Use beginTransfer for on-chain ownership changes.",
    docIds: ["verification:methods"],
    cautions: ["Run verifyResponse on your server, not in the native client."],
  },
  lookup_after_tap: {
    method: "verifyResponse → fetchAssetsByPublicKey",
    sdkExports: ["verifyResponse", "fetchAssetsByPublicKey", "fetchAsset"],
    requiresTap: true,
    onChain: false,
    rationale:
      "After verifyResponse, look up the asset by passkey public key. PDA is seeded by chip identifier (distinct from the passkey).",
    docIds: ["verification:methods", "sdk:surface-area"],
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
    { id: "lookup_after_tap", summary: "Verify tap then load on-chain asset state" },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Authentication (live NFC tap required)
├── Need on-chain ownership change?
│   YES → beginTransfer → completeTransfer (execute_transfer)
│   NO  → startAuthentication (client tap)
│         → verifyResponse (server verify)
│         → optional: fetchAssetsByPublicKey(rpc, secp256r1PublicKey)
└── Know the chip identifier already?
    → findAssetPda(identifier) / fetchAsset(rpc, pda)

verifyResponse never submits an on-chain ix. Returns { isVerified, secp256r1PublicKey }
(response.id is the secp256r1 vault key / WebAuthn credential id). Run it on your server.
Chip identifier (PDA seed) is distinct from the passkey public key.
There is no signed-URL / prior-scan identification path — every check needs a fresh tap.
`.trim();
