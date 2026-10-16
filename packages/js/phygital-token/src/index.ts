export {
  beginTransfer,
  completeTransfer,
  authenticatePasskeyForTransfer,
  type TransferSession,
} from "./instructions/transfer.js";

export {
  buildMessageHash,
  buildVerifyChallenge,
  authenticatePasskeyForSecp256r1Verify,
  buildSecp256r1VerifyInstruction,
} from "./instructions/verify.js";

export { buildSecp256r1VerifyInstructionFromWebAuthnResponse } from "./utils/passkey/secp256r1.js";
export { bufferToBase64URLString } from "./utils/passkey/webauthn.js";
export { decodeBase64AccountData, getLatestSlotHash } from "./utils/slotHash.js";

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

export { isPhygitalTokenLocked } from "./utils/lock.js";

export * from "./generated/index.js";
