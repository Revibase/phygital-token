export {
  beginTransfer,
  completeTransfer,
  authenticatePasskeyForTransfer,
  type TransferSession,
} from "./instructions/transfer.js";

export {
  buildInitializeInstruction,
  parseSecp256r1Pubkey,
  parseIdentifier,
  type InitializeParams,
} from "./instructions/initialize.js";

export {
  fetchAssetsByPublicKey,
  fetchAllAssetsFromOwner,
} from "./utils/metadata.js";

export {
  startAuthentication,
  verifyResponse,
  type VerifyResponseResult,
  type VerifyResponseOptions,
} from "./utils/verify.js";

export { findAssetPda } from "./utils/pdas/index.js";

export * from "./generated/index.js";

export {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
  type Secp256r1VerifyInstruction,
} from "./instructions/internal/secp256r1Verify.js";

export {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  buildVerifyInputFromWebAuthn,
  type WebAuthnSecp256r1Verification,
} from "./utils/passkey/secp256r1.js";
