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
  type NfcTransceive,
} from "./utils/passkey/authenticate.js";

export {
  PhygitalTokenError,
  type PhygitalTokenErrorCode,
} from "./utils/errors.js";

export { findPhygitalTokenPda } from "./utils/pdas/index.js";

export * from "./generated/index.js";
