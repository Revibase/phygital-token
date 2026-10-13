import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  deriveWrappingKey,
  ed25519PublicKey,
  ed25519Sign,
  generateEd25519SeedAndPublicKey,
  randomBytes,
  scrub,
} from "./crypto.js";
import { AES_GCM_IV_BYTES, KDF_SALT_BYTES } from "../constants.js";
import { bytesEqual } from "../encoding.js";
import {
  buildAad,
  decodeWalletBlob,
  encodeWalletBlob,
  type ParsedWalletBlob,
} from "./wallet-format.js";
import type { ErrorCode } from "../messaging/protocol.js";
import { PrfUnsupported } from "./webauthn.js";

export class ServiceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
  }
}

export interface PrfResult {
  credentialId: Uint8Array;
  prfOutput: Uint8Array;
}

export interface PrfCreateOptions {
  userName: string;
}

export interface PrfProvider {
  create(rpId: string, opts: PrfCreateOptions): Promise<PrfResult>;
  get(
    rpId: string,
    credentialId: Uint8Array,
    challenge?: Uint8Array,
  ): Promise<{ prfOutput: Uint8Array }>;
}

export interface CreatedWallet {
  publicKey: Uint8Array;
  blob: Uint8Array;
  signature?: Uint8Array;
}

export async function createWallet(
  prf: PrfProvider,
  rpId: string,
  opts: { userName: string; messageToSign?: Uint8Array },
): Promise<CreatedWallet> {
  let prfOutput: Uint8Array | undefined;
  try {
    const enrolled = await prf.create(rpId, { userName: opts.userName });
    prfOutput = enrolled.prfOutput;
    return await wrapNewSeed(prfOutput, enrolled.credentialId, rpId, opts);
  } finally {
    scrub(prfOutput);
  }
}

/** Parent-created passkey (shared RP ID); PRF + wrap stay in the signer. */
export async function enrollExistingCredential(
  prf: PrfProvider,
  rpId: string,
  credentialId: Uint8Array,
  opts: {
    /** May be a Promise so callers can mint a backup challenge *after* WebAuthn get. */
    messageToSign?: Uint8Array | Promise<Uint8Array>;
  } = {},
): Promise<CreatedWallet> {
  let prfOutput: Uint8Array | undefined;
  try {
    const got = await prf.get(rpId, credentialId);
    prfOutput = got.prfOutput;
    if (!opts.messageToSign) {
      return await wrapNewSeed(prfOutput, credentialId, rpId, {});
    }
    return await wrapNewSeed(prfOutput, credentialId, rpId, {
      messageToSign: await opts.messageToSign,
    });
  } finally {
    scrub(prfOutput);
  }
}

async function wrapNewSeed(
  prfOutput: Uint8Array,
  credentialId: Uint8Array,
  rpId: string,
  opts: {
    messageToSign?: Uint8Array;
  },
): Promise<CreatedWallet> {
  let seed: Uint8Array | undefined;
  try {
    const generated = await generateEd25519SeedAndPublicKey();
    seed = generated.seed;
    const publicKey = generated.publicKey;
    const kdfSalt = randomBytes(KDF_SALT_BYTES);
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const key = await deriveWrappingKey(prfOutput, kdfSalt);
    const aad = buildAad({ publicKey, credentialId, kdfSalt }, rpId);
    const ciphertext = await aesGcmEncrypt(key, iv, seed, aad);
    const blob = encodeWalletBlob({
      publicKey,
      credentialId,
      kdfSalt,
      iv,
      ciphertext,
    });
    return {
      publicKey,
      blob,
      ...(opts.messageToSign ? { signature: await ed25519Sign(opts.messageToSign, seed) } : {}),
    };
  } finally {
    scrub(seed);
  }
}

export function parseBlob(blob: Uint8Array): ParsedWalletBlob {
  try {
    return decodeWalletBlob(blob);
  } catch {
    throw new ServiceError("INVALID_WALLET_BLOB");
  }
}

/** Caller must scrub the returned seed. */
export async function decryptWallet(
  prf: PrfProvider,
  rpId: string,
  parsed: ParsedWalletBlob,
): Promise<{ seed: Uint8Array; publicKey: Uint8Array }> {
  let prfOutput: Uint8Array | undefined;
  try {
    const got = await prf.get(rpId, parsed.credentialId);
    prfOutput = got.prfOutput;
  } catch (e) {
    if (e instanceof PrfUnsupported) throw new ServiceError("PRF_UNSUPPORTED", { cause: e });
    // Kept as the cause so callers can tell a dismissed prompt from a failure.
    throw new ServiceError("AUTHENTICATION_FAILED", { cause: e });
  }
  try {
    return await unwrapWallet(prfOutput, parsed, rpId);
  } finally {
    scrub(prfOutput);
  }
}

/** Caller must scrub `prfOutput`. */
export async function unwrapWallet(
  prfOutput: Uint8Array,
  parsed: ParsedWalletBlob,
  rpId: string,
): Promise<{ seed: Uint8Array; publicKey: Uint8Array }> {
  const key = await deriveWrappingKey(prfOutput, parsed.kdfSalt);
  const aad = buildAad(parsed, rpId);
  let seed: Uint8Array;
  try {
    seed = await aesGcmDecrypt(key, parsed.iv, parsed.ciphertext, aad);
  } catch {
    throw new ServiceError("DECRYPTION_FAILED");
  }
  const publicKey = await ed25519PublicKey(seed);
  if (!bytesEqual(publicKey, parsed.publicKey)) {
    scrub(seed);
    throw new ServiceError("WALLET_MISMATCH");
  }
  return { seed, publicKey };
}

export async function signAndScrub(
  messageBytes: Uint8Array,
  seed: Uint8Array,
): Promise<Uint8Array> {
  try {
    return await ed25519Sign(messageBytes, seed);
  } finally {
    scrub(seed);
  }
}
