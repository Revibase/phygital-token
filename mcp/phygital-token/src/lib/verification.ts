export type VerificationUseCase =
  | "product_page_lookup"
  | "deep_link_from_prior_scan"
  | "offline_identification"
  | "login_ui_only"
  | "onchain_standalone_verify"
  | "onchain_inspect_verify_asset"
  | "onchain_cpi_verify_asset"
  | "transfer_ownership"
  | "native_mobile_app";

export type OnChainCompositionPattern = "inspect" | "cpi" | "standalone";

export type VerificationRecommendation = {
  method: string;
  sdkExports: string[];
  requiresTap: boolean;
  onChain: boolean;
  onChainPattern?: OnChainCompositionPattern;
  rationale: string;
  docIds: string[];
  cautions?: string[];
};

const RECOMMENDATIONS: Record<VerificationUseCase, VerificationRecommendation> = {
  product_page_lookup: {
    method: "identification — verifyDynamicUrl",
    sdkExports: ["verifyDynamicUrl"],
    requiresTap: false,
    onChain: false,
    rationale:
      "User already scanned; signed URL params identify the asset without a second tap.",
    docIds: ["verification:methods", "verification:overview"],
  },
  deep_link_from_prior_scan: {
    method: "identification — verifyDynamicUrl",
    sdkExports: ["verifyDynamicUrl"],
    requiresTap: false,
    onChain: false,
    rationale: "Signed deep-link params from an earlier tap.",
    docIds: ["verification:methods"],
  },
  offline_identification: {
    method: "identification — verifyDynamicUrlWithoutCounterCheck",
    sdkExports: ["verifyDynamicUrlWithoutCounterCheck"],
    requiresTap: false,
    onChain: false,
    rationale: "Local signature check only. Not for authorization.",
    docIds: ["verification:methods"],
    cautions: ["Copied links can be replayed."],
  },
  login_ui_only: {
    method: "authentication off-chain — startAuthentication + verifyResponse",
    sdkExports: [
      "startAuthentication",
      "verifyResponse",
    ],
    requiresTap: true,
    onChain: false,
    rationale:
      "Server issues challenge; client taps NFC via startAuthentication; server verifies with verifyResponse. No on-chain transaction.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: ["Run verifyResponse on your server, not in the browser."],
  },
  onchain_standalone_verify: {
    method: "on-chain verify_asset only",
    sdkExports: ["beginVerifyAsset", "authenticatePasskeyForVerifyAsset", "completeVerifyAsset"],
    requiresTap: true,
    onChain: true,
    onChainPattern: "standalone",
    rationale: "Record passkey proof on-chain without a custom program.",
    docIds: ["verification:verify-asset-composable"],
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
    onChainPattern: "inspect",
    rationale:
      "Client includes verify_asset in the tx. Your program scans instructions sysvar for that verify_asset and validates message bytes.",
    docIds: [
      "verification:verify-asset-composable",
      "building-on-phygital:overview",
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
    onChainPattern: "cpi",
    rationale:
      "Client includes secp256r1_verify + your ix only. Your program CPIs verify_asset using args from buildVerifyAssetArgs.",
    docIds: [
      "verification:verify-asset-composable",
      "building-on-phygital:rust-cpi",
      "building-on-phygital:overview",
    ],
  },
  transfer_ownership: {
    method: "transfer — beginTransfer / completeTransfer",
    sdkExports: ["beginTransfer", "authenticatePasskeyForTransfer", "completeTransfer"],
    requiresTap: true,
    onChain: true,
    rationale: "Token claim uses execute_transfer, not verify_asset.",
    docIds: ["verification:overview"],
    cautions: ["Do not use verifyDynamicUrl for transfers."],
  },
  native_mobile_app: {
    method: "authentication off-chain — startAuthentication (transceive) + verifyResponse",
    sdkExports: [
      "startAuthentication",
      "verifyResponse",
    ],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive to startAuthentication for native NFC readers; verify on server. Use beginVerifyAsset for on-chain proof.",
    docIds: ["verification:methods"],
    cautions: ["Run verifyResponse on your server, not in the native client."],
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
    { id: "product_page_lookup", summary: "Product page from prior scan URL" },
    { id: "deep_link_from_prior_scan", summary: "App opens from signed deep link" },
    { id: "offline_identification", summary: "Identify asset offline (weak replay)" },
    { id: "login_ui_only", summary: "Off-chain tap-to-login (no chain tx)" },
    { id: "onchain_standalone_verify", summary: "On-chain verify_asset only" },
    {
      id: "onchain_inspect_verify_asset",
      summary: "Pattern A: client posts verify_asset, your program inspects message",
    },
    {
      id: "onchain_cpi_verify_asset",
      summary: "Pattern B: buildVerifyAssetArgs, your program CPIs verify_asset",
    },
    { id: "transfer_ownership", summary: "Claim/transfer token to new owner" },
    { id: "native_mobile_app", summary: "Native app off-chain authentication" },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Identification vs Authentication
├── Need holder present NOW?
│   NO → verifyDynamicUrl / verifyDynamicUrlWithoutCounterCheck
│   YES → Need on-chain proof?
│         NO → startAuthentication (client tap)
│              → verifyResponse (server verify) — off-chain only
│         YES → beginVerifyAsset composable flow:
│               Pattern A: [secp256r1_verify, verify_asset, your_ix] — program inspects sysvar
│               Pattern B: [secp256r1_verify, your_ix] — program CPIs verify_asset
└── Transfer ownership? → beginTransfer → completeTransfer

verifyResponse never submits verify_asset. Returns { isVerified, asset } (owner is asset.owner). Run it on your server. On-chain proof always uses beginVerifyAsset.
`.trim();
