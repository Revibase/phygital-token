/**
 * Test harnesses for the secure-signer, for this package and for hosts'
 * integration tests (`secure-signer/testing`). Test-only: never import from
 * production code. The harness needs vitest; runners without it (Playwright)
 * import the tx fixtures alone from `secure-signer/testing/tx-fixtures`.
 */
export * from "./harness.js";
export * from "./fake-backup-api.js";
export * from "./memory-store.js";
export * from "./scripted-ui.js";
export * from "./tx-fixtures.js";
export { createTestWallet, type TestWallet } from "./test-wallet.js";
/** For hosts checking signer output: signature verification and the signer's codecs. */
export { ed25519Verify } from "../src/keys/crypto.js";
export { base64ToBytes, bytesToBase64 } from "../src/encoding.js";
