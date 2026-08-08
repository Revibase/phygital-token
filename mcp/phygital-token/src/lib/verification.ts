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
    rationale: "Ownership claim uses execute_transfer (updates asset.owner; no SPL token).",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: [
      "Do not use verifyResponse alone for transfers — it does not change on-chain ownership.",
      "Do not use verify_asset for transfers — it proves possession without changing owner.",
    ],
  },
  native_mobile_app: {
    method: "authentication — startAuthentication (transceive) + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive to startAuthentication for native NFC readers; verify on server. Use beginVerifyAsset for on-chain proof, beginTransfer for ownership changes.",
    docIds: ["verification:methods", "verification:verify-asset-composable"],
    cautions: ["Run verifyResponse on your server, not in the native client."],
  },
  lookup_after_tap: {
    method: "verifyResponse → findAssetPda + fetchAsset",
    sdkExports: ["verifyResponse", "findAssetPda", "fetchAsset", "parseSecp256r1Pubkey"],
    requiresTap: true,
    onChain: false,
    rationale:
      "After verifyResponse, derive the asset PDA from the passkey public key and fetch the account. Chip identifier is a binding field on the asset, not the PDA seed.",
    docIds: ["verification:methods", "sdk:surface-area"],
  },
  onchain_standalone_verify: {
    method: "on-chain verify_asset only",
    sdkExports: [
      "beginVerifyAsset",
      "authenticatePasskeyForVerifyAsset",
      "completeVerifyAsset",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Publish a possession proof on-chain without a custom program. Updates last_sign_count; does not change owner.",
    docIds: [
      "verification:verify-asset-composable",
      "building-on-phygital:rust-cpi",
    ],
  },
  onchain_inspect_verify_asset: {
    method: "Pattern A — client posts verify_asset, your program inspects message",
    sdkExports: [
      "beginVerifyAsset",
      "authenticatePasskeyForVerifyAsset",
      "completeVerifyAsset",
      "getVerifyAssetInstruction",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Client includes verify_asset in the tx. Your program scans instructions sysvar for that verify_asset and validates message bytes.",
    docIds: [
      "verification:verify-asset-composable",
      "building-on-phygital:rust-cpi",
    ],
  },
  onchain_cpi_verify_asset: {
    method: "Pattern B — buildVerifyAssetArgs, your program CPIs verify_asset",
    sdkExports: [
      "beginVerifyAsset",
      "authenticatePasskeyForVerifyAsset",
      "buildVerifyAssetArgs",
    ],
    requiresTap: true,
    onChain: true,
    rationale:
      "Client includes secp256r1_verify + your ix only. Your program CPIs verify_asset using args from buildVerifyAssetArgs.",
    docIds: [
      "verification:verify-asset-composable",
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
    { id: "lookup_after_tap", summary: "Verify tap then load on-chain asset state" },
    { id: "onchain_standalone_verify", summary: "On-chain verify_asset only" },
    {
      id: "onchain_inspect_verify_asset",
      summary: "Pattern A: client posts verify_asset, your program inspects message",
    },
    {
      id: "onchain_cpi_verify_asset",
      summary: "Pattern B: buildVerifyAssetArgs, your program CPIs verify_asset",
    },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Authentication (live NFC tap required)
├── Need on-chain ownership change?
│   YES → beginTransfer → completeTransfer (execute_transfer)
│   NO  → Need on-chain possession proof for your program?
│         YES → beginVerifyAsset composable flow:
│               Pattern A: [secp256r1_verify, verify_asset, your_ix] — program inspects sysvar
│               Pattern B: [secp256r1_verify, your_ix] — program CPIs verify_asset
│         NO  → startAuthentication (client tap)
│               → verifyResponse (server verify)
│               → optional: findAssetPda(secp256r1PublicKey) / fetchAsset
└── Know the passkey already?
    → findAssetPda(secp256r1Pubkey) / fetchAsset(rpc, pda)

verifyResponse never submits verify_asset. Returns { isVerified, secp256r1PublicKey }
(response.id is the secp256r1 vault key / WebAuthn credential id). Run it on your server.
Asset PDA is seeded by the passkey public key; chip identifier is a separate binding field.
On-chain proof always uses beginVerifyAsset({ messageHash }); PDA is derived after the NFC tap.
`.trim();
