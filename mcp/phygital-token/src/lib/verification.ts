export type VerificationUseCase =
  | "product_page_lookup"
  | "deep_link_from_prior_scan"
  | "offline_identification"
  | "login_ui_only"
  | "vault_gated_experience"
  | "onchain_standalone_verify"
  | "onchain_inspect_verify_asset"
  | "onchain_cpi_verify_asset"
  | "transfer_ownership"
  | "wallet_holdings_gate"
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

export const ON_CHAIN_PATTERNS = {
  inspect: {
    id: "inspect" as const,
    name: "Pattern A — client posts verify_asset, program inspects",
    clientTransaction: ["secp256r1_verify", "verify_asset", "your_program_ix"],
    clientSdk: ["beginVerifyAsset", "completeVerifyAsset", "getVerifyAssetInstruction"],
    programRust: "Scan instructions sysvar for preceding verify_asset; check message bytes",
    reference: "programs/phygital-spend",
  },
  cpi: {
    id: "cpi" as const,
    name: "Pattern B — client posts secp256r1_verify, program CPIs verify_asset",
    clientTransaction: ["secp256r1_verify", "your_program_ix"],
    clientSdk: ["beginVerifyAsset", "buildVerifyAssetArgs"],
    programRust: "VerifyAssetCpiBuilder from phygital-token-client",
    reference: "clients/rust/phygital-token",
  },
  standalone: {
    id: "standalone" as const,
    name: "Standalone on-chain verify_asset (no custom program)",
    clientTransaction: ["secp256r1_verify", "verify_asset"],
    clientSdk: ["beginVerifyAsset", "completeVerifyAsset"],
    programRust: "N/A",
  },
} as const;

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
    method: "authentication off-chain — startAuthentication + verifyWithChallengeResponse",
    sdkExports: [
      "startAuthenticationWithChallengeResponse",
      "verifyWithChallengeResponse",
    ],
    requiresTap: true,
    onChain: false,
    rationale:
      "Server issues challenge; client taps NFC via startAuthenticationWithChallengeResponse; server verifies with verifyWithChallengeResponse. No on-chain transaction.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: ["Run verifyWithChallengeResponse on your server, not in the browser."],
  },
  vault_gated_experience: {
    method: "vault gate — server-verified tap + evaluateAssetGating",
    sdkExports: [
      "startAuthenticationWithChallengeResponse",
      "verifyWithChallengeResponse",
      "evaluateAssetGating",
      "Gating",
      "GatingTraitValue",
    ],
    requiresTap: true,
    onChain: false,
    rationale:
      "Prove vault holder is present (server-verified tap), then check owner wallet holdings for tiered unlock.",
    docIds: ["verification:methods", "verification:overview", "gating:overview"],
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
  wallet_holdings_gate: {
    method: "gating — evaluateAssetGating",
    sdkExports: ["evaluateAssetGating", "Gating", "GatingTraitValue"],
    requiresTap: false,
    onChain: false,
    rationale: "Wallet holdings via DAS given an asset publicKey. Pair with off-chain tap auth when you need live presence.",
    docIds: ["gating:overview"],
    cautions: [
      "For Revi Ring / live presence: startAuthenticationWithChallengeResponse + verifyWithChallengeResponse first, then evaluateAssetGating.",
    ],
  },
  native_mobile_app: {
    method: "authentication off-chain — startAuthentication (transceive) + verifyWithChallengeResponse",
    sdkExports: [
      "startAuthenticationWithChallengeResponse",
      "verifyWithChallengeResponse",
    ],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass transceive to startAuthenticationWithChallengeResponse for native NFC readers; verify on server. Use beginVerifyAsset for on-chain proof.",
    docIds: ["verification:methods"],
    cautions: ["Run verifyWithChallengeResponse on your server, not in the native client."],
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
    { id: "vault_gated_experience", summary: "Revi Ring gate: tap + wallet holdings check" },
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
    { id: "wallet_holdings_gate", summary: "Gate by wallet NFTs/tokens" },
    { id: "native_mobile_app", summary: "Native app off-chain authentication" },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Identification vs Authentication
├── Need holder present NOW?
│   NO → verifyDynamicUrl / verifyDynamicUrlWithoutCounterCheck
│   YES → Need on-chain proof?
│         NO → startAuthenticationWithChallengeResponse (client tap)
│              → verifyWithChallengeResponse (server verify) — off-chain only
│         YES → beginVerifyAsset composable flow:
│               Pattern A: [secp256r1_verify, verify_asset, your_ix] — program inspects sysvar
│               Pattern B: [secp256r1_verify, your_ix] — program CPIs verify_asset
└── Transfer ownership? → beginTransfer → completeTransfer

verifyWithChallengeResponse never submits verify_asset. Run it on your server. On-chain proof always uses beginVerifyAsset.
`.trim();
