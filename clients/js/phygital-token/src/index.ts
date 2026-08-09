export {
  beginTransfer,
  completeTransfer,
  authenticatePasskeyForTransfer,
  type TransferSession,
} from "./instructions/transfer.js";

export {
  beginVerifyAsset,
  completeVerifyAsset,
  authenticatePasskeyForVerifyAsset,
  buildVerifyAssetArgs,
  type VerifyAssetSession,
} from "./instructions/verifyAsset.js";

export {
  buildInitializeInstruction,
  parseSecp256r1Pubkey,
  parseIdentifier,
  type InitializeParams,
} from "./instructions/initialize.js";

export {
  buildSquadsInitializeInstructions,
  type BuildSquadsInitializeInput,
  type BuildSquadsInitializeResult,
} from "./instructions/squadsInitialize.js";

export {
  fetchAssetByIdentifier,
  fetchAllAssetsFromOwner,
} from "./utils/metadata.js";

export {
  startAuthentication,
  verifyResponse,
  type VerifyResponseResult,
  type VerifyResponseOptions,
} from "./utils/verify.js";

export { findAssetPda } from "./utils/pdas/index.js";

export { INITIALIZE_AUTHORITY, INITIALIZE_MULTISIG_PDA } from "./utils/consts.js";

export * from "./generated/index.js";

export {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
  type Secp256r1VerifyInstruction,
} from "./instructions/internal/secp256r1Verify.js";

export {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  buildVerifyAssetChallenge,
  buildVerifyAssetChallengeFromMessage,
  buildVerifyInputFromWebAuthn,
  type WebAuthnSecp256r1Verification,
} from "./utils/passkey/secp256r1.js";
