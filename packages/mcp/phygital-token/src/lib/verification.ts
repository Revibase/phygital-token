export type VerificationUseCase =
  | "login_ui_only"
  | "set_linked_wallet"
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
    method: "startAuthentication(message, { rpc }) + verifyResponse → your session",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Issue any short-lived message string as the challenge. Client taps with startAuthentication; server verifies with verifyResponse (secp256r1 only — no rpId/origin binding). Then create your session. Browser recovery needs Kit Rpc.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: [
      "Run verifyResponse on your server, not in the browser.",
      "Native APDU: startAuthentication(message, { transceive }) — rpId/origin not required.",
      "SDK does not set cookies — create the session after isVerified: true.",
    ],
  },
  set_linked_wallet: {
    method: "transfer — beginTransfer / completeTransfer",
    sdkExports: ["beginTransfer", "authenticatePasskeyForTransfer", "completeTransfer"],
    requiresTap: true,
    onChain: true,
    rationale:
      "Linked-wallet claim uses set_linked_wallet (updates phygital_token.linked_wallet; no SPL token). Requires is_locked == 0. beginTransfer takes secp256r1Pubkey and derives the token PDA. Pass { transceive } for native APDU.",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: [
      "Do not use off-chain login verify alone for transfers — it does not change phygital_token.linked_wallet.",
      "Do not use verify for transfers — it proves possession without changing linked_wallet.",
      "Recipient must sign the transaction — pass completeTransfer a Kit TransactionSigner.",
      "Token must be unlocked (is_locked == 0). Permanent tokens stay locked and always fail with TokenIsCurrentlyLocked.",
    ],
  },
  native_mobile_app: {
    method: "startAuthentication(message, { transceive }) + verifyResponse",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Pass { transceive } for native NFC readers (rpId/origin optional). Verify on server with verifyResponse. Rpc is optional when transceive is set.",
    docIds: ["verification:methods", "verification:verify-composable"],
    cautions: [
      "Run verifyResponse on your server, not in the native client.",
      "Create your normal session after isVerified: true.",
    ],
  },
  lookup_after_tap: {
    method: "verifyResponse → findPhygitalTokenPda + fetchPhygitalToken",
    sdkExports: ["verifyResponse", "findPhygitalTokenPda", "fetchPhygitalToken"],
    requiresTap: true,
    onChain: false,
    rationale:
      "After verify, use secp256r1PublicKey to derive the token PDA and fetch the account. Chip identifier is a binding field on the token, not the PDA seed.",
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
    { id: "set_linked_wallet", summary: "Claim/set linked wallet to a new address" },
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
├── Need on-chain linked-wallet change?
│   YES → beginTransfer({ rpc, secp256r1Pubkey })
│         → authenticatePasskeyForTransfer(session, { transceive? })
│         → completeTransfer (set_linked_wallet; requires is_locked == 0)
│   NO  → Need on-chain possession proof for your program?
│         YES → buildMessageHash(message)
│               → authenticatePasskeyForSecp256r1Verify({ rpc, messageHash, transceive? })
│               → buildSecp256r1VerifyInstruction(tap)
│               [secp256r1_verify, your_program_instruction] — program CPIs verify
│         NO  → startAuthentication(message, { rpc }) → verifyResponse
│               → create your session
│               optional: findPhygitalTokenPda / fetchPhygitalToken
└── Know the passkey already?
    → findPhygitalTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)

WebAuthn credential id:
- rawId 33 bytes → authenticator returned the passkey public key
- rawId 16 bytes → platform echoed random placeholder; startAuthentication needs rpc
- ambiguous recovery → pick candidate with initialized PhygitalToken PDA on-chain

On-chain tap helpers share authenticatePasskey: { transceive } → APDU; else browser WebAuthn.
Off-chain login: issue any message string → startAuthentication → verifyResponse (no rpId/origin checks).
Browser placeholder recovery requires Kit Rpc (optional when transceive is set).
verifyResponse never submits on-chain verify. Run it on your server.
Token PDA is seeded by the passkey public key; chip identifier is a separate binding field.
Optional expected_rp_id / expected_origins are set on VerifyCpiBuilder (omit to skip).
PDA is derived after the NFC tap. Your program always CPIs verify — do not post a client-side verify instruction.
set_linked_wallet requires is_locked == 0 (Permanent stays locked → TokenIsCurrentlyLocked).
`.trim();
