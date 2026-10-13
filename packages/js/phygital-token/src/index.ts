export {
  beginTransfer,
  completeTransfer,
  authenticatePasskeyForTransfer,
  type TransferSession,
} from "./instructions/transfer.js";

export {
  buildMessageHash,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "./instructions/verify.js";

export { parseSecp256r1Pubkey } from "./utils/parseSecp256r1Pubkey.js";

export {
  fetchPhygitalTokenByIdentifier,
  fetchPhygitalTokensByOwner,
  fetchPhygitalTokenByMint,
} from "./utils/metadata.js";

export {
  startAuthentication,
  verifyResponse,
  type AuthenticationResponseJSON,
} from "./utils/verify.js";

export {
  authenticatePasskey,
  type AuthenticatePasskeyOptions,
} from "./utils/passkey/authenticate.js";

export { PhygitalTokenError, type PhygitalTokenErrorCode } from "./utils/errors.js";

export { findPhygitalTokenPda } from "./utils/pdas/index.js";

export { isPhygitalTokenLocked, getPolicyCloseAccounts } from "./utils/policy.js";

export {
  getPhygitalWalletSigner,
  type PhygitalWalletSignPhase,
  type PhygitalWalletSignerCallbacks,
  type PhygitalWalletSignerConfig,
} from "./wallet/signer.js";
export {
  buildExecuteChallenge,
  buildExecuteWithOwnerInstruction,
  compileWalletInstructions,
  elevateRemainingForExecuteChallenge,
  withRemainingAccounts,
  EXECUTE_WITH_ACCESSORY_NAMED_ACCOUNT_COUNT,
  EXECUTE_WITH_OWNER_NAMED_ACCOUNT_COUNT,
  PREVIEW_EXECUTE_NAMED_ACCOUNT_COUNT,
} from "./wallet/compile.js";
export {
  createDefaultFeePayer,
  createSponsorFeePayer,
  createSponsorFeePayers,
  DEFAULT_FEE_PAYER_ENDPOINT,
  fetchPrepaidFees,
  fetchSponsor,
  pickFeePayer,
  type SponsorConfig,
  type SponsorInfo,
} from "./wallet/fee-payer.js";
export {
  AccessoryWalletTopUpRequired,
  canSpendLamports,
  DEFAULT_PREPAID_FEE_LAMPORTS,
  getRefillInstruction,
  LAMPORTS_PER_SIGNATURE,
  networkFeeLamports,
  parseSolTransfer,
  planFee,
  RefillBlockedByTapLimit,
  topUpNeeded,
  WALLET_RENT_EXEMPT_LAMPORTS,
} from "./wallet/fees.js";
export type { FeePlan } from "./wallet/wrap-transaction.js";
export {
  failingProgramFromLogs,
  isPreviewPassed,
  POLICY_DENIAL_CODES,
  PolicyDeniedError,
  policyDeniedErrorFromSolanaError,
} from "./wallet/preview.js";

export {
  getRevibaseAccessorySession,
  registerPhygitalWallet,
  RevibaseAccessory,
  REVIBASE_WALLET_NAME,
  type PhygitalWalletOptions,
  type RevibaseAccessoryFeature,
  type RevibaseAccessoryGetSessionOptions,
} from "./wallet-standard/index.js";
export {
  PHYGITAL_WALLET_CHAINS,
  resolveWalletSession,
  type PhygitalWalletSession,
} from "./wallet-standard/session.js";

export * from "./generated/index.js";
export {
  bytesToHex,
  hexToBytes,
  isValidOrigin,
  parsePermissionSet,
  parseRule,
  periodFromSeconds,
  periodSeconds,
  PERMISSION_LIMITS,
  PermissionFormatError,
  ruleFromProgram,
  ruleToArgs,
  sameRule,
  selectorsOverlap,
  type AccountCheckJson,
  type DataCheckJson,
  type LimitJson,
  type Period,
  type PermissionSet,
  type ProgramJson,
  type RuleJson,
} from "./permissions/format.js";
export {
  decodePermissionRequest,
  encodePermissionRequest,
  fetchPermissionRequest,
  MAX_REQUEST_BYTES,
  PERMISSIONS_URL,
} from "./permissions/request.js";
