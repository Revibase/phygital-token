export type VerificationUseCase =
  "login_ui_only" | "set_owner" | "lookup_after_tap" | "onchain_cpi_verify";

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
    method: "startAuthentication(message, { rpc, allowList? }) + verifyResponse → your session",
    sdkExports: ["startAuthentication", "verifyResponse"],
    requiresTap: true,
    onChain: false,
    rationale:
      "Issue any short-lived message string as the challenge. Client taps with startAuthentication; server verifies with verifyResponse, passing expectedOrigin (your site's origin) so taps made on other sites are rejected. Then create your session. Browser taps recover a placeholder id via Kit Rpc, falling back to allowList; allowList also gates the tapped id.",
    docIds: ["verification:methods", "verification:overview"],
    cautions: [
      "Run verifyResponse on your server, not in the browser.",
      "Pass expectedOrigin as a fixed value for your site, not the request's Origin header.",
      "SDK does not set cookies — create the session after isVerified: true.",
    ],
  },
  set_owner: {
    method: "transfer — beginTransfer / completeTransfer",
    sdkExports: ["beginTransfer", "authenticatePasskeyForTransfer", "completeTransfer"],
    requiresTap: true,
    onChain: true,
    rationale:
      "Owner claim uses set_owner (updates phygital_token.owner; no SPL token). Requires an unlocked token. beginTransfer takes secp256r1Pubkey and derives the token PDA.",
    docIds: ["verification:overview", "sdk:surface-area"],
    cautions: [
      "Do not use off-chain login verify alone for transfers — it does not change phygital_token.owner.",
      "Do not use verify for transfers — it proves possession without changing owner.",
      "Recipient must sign the transaction — pass completeTransfer a Kit TransactionSigner.",
      "Token must be unlocked (Bearer, or a Controlled token with no owner). Permanent tokens are always locked and fail with TokenIsCurrentlyLocked.",
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
      "Client prepends secp256r1_verify and passes phygitalTokenPda + secp256r1VerifyArgs into your instruction. Tap takes rpc (recovery) and/or allowList (gate, no-RPC fallback). Your program CPIs verify with VerifyCpiBuilder.",
    docIds: ["verification:verify-composable", "building-on-phygital:rust-cpi"],
  },
};

export function recommendVerification(useCase: VerificationUseCase): VerificationRecommendation {
  return RECOMMENDATIONS[useCase];
}

export function listVerificationUseCases(): Array<{
  id: VerificationUseCase;
  summary: string;
}> {
  return [
    { id: "login_ui_only", summary: "Off-chain tap-to-login (no chain tx)" },
    { id: "set_owner", summary: "Claim/set owner to a new address" },
    { id: "lookup_after_tap", summary: "Verify tap then load on-chain token state" },
    {
      id: "onchain_cpi_verify",
      summary: "On-chain proof: your program CPIs verify",
    },
  ];
}

export const VERIFICATION_DECISION_TREE = `
Authentication (live NFC tap required)
├── Need on-chain owner change?
│   YES → beginTransfer({ rpc, secp256r1Pubkey })
│         → authenticatePasskeyForTransfer(session)
│         → completeTransfer (set_owner; requires an unlocked token)
│   NO  → Need on-chain possession proof for your program?
│         YES → buildMessageHash(message)
│               → authenticatePasskeyForSecp256r1Verify({ rpc, allowList?, messageHash })
│               → buildSecp256r1VerifyInstruction(tap)
│               [secp256r1_verify, your_program_instruction] — program CPIs verify
│         NO  → startAuthentication(message, { rpc, allowList? }) → verifyResponse({ expectedMessage, expectedOrigin, response })
│               → create your session
│               optional: findPhygitalTokenPda / fetchPhygitalToken
└── Know the passkey already?
    → findPhygitalTokenPda(secp256r1Pubkey) / fetchPhygitalToken(rpc, pda)

WebAuthn credential id:
- rawId 33 bytes → authenticator returned the passkey public key
- rawId 16 bytes → platform echoed random placeholder; startAuthentication recovers via rpc, falling back to allowList
- ambiguous recovery → pick candidate with initialized PhygitalToken PDA on-chain

Taps always use browser WebAuthn (shared authenticatePasskey helper).
Off-chain login: issue any message string → startAuthentication → verifyResponse with expectedOrigin (taps from other origins throw ORIGIN_MISMATCH).
Browser placeholder recovery uses Kit Rpc, falling back to allowList.
verifyResponse never submits on-chain verify. Run it on your server.
Token PDA is seeded by the passkey public key; chip identifier is a separate binding field.
Optional expected_rp_id / expected_origins are set on VerifyCpiBuilder (omit to skip).
PDA is derived after the NFC tap. Your program always CPIs verify — do not post a client-side verify instruction.
set_owner requires an unlocked token (Permanent and owned Controlled are locked → TokenIsCurrentlyLocked).
`.trim();
