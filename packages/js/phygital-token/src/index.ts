export {
  startAuthentication,
  verifyResponse,
  type AuthenticationResponseJSON,
  type VerifiedTap,
} from "./utils/verify.js";
export {
  getSecp256r1VerifyInstruction,
  type Secp256r1VerifyEntry,
} from "./instructions/secp256r1Verify.js";
export { buildProductAllowListId } from "./utils/passkey/productKey.js";
export { enrollCard, type RegistrationResponseJSON } from "./utils/passkey/webauthn.js";
export { AUTHORIZE_PREFIX, MAX_AUTHORIZE_PAYLOAD } from "./utils/consts.js";

export { findPhygitalTokenPda } from "./utils/pdas/index.js";
export { parseSecp256r1Pubkey } from "./utils/parseSecp256r1Pubkey.js";
export { fetchPhygitalTokenByIdentifier, fetchPhygitalTokensByOwner } from "./utils/metadata.js";
export { isPhygitalTokenLocked } from "./utils/lock.js";

export { PhygitalTokenError, type PhygitalTokenErrorCode } from "./utils/errors.js";

export * from "./generated/index.js";
