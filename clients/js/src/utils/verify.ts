import {
  Endian,
  getU32Encoder,
} from "@solana/kit";
import {
  base64URLStringToBuffer,
  normalizeSignatureToLowS,
} from "./passkey/internal.js";
import { p256 } from "@noble/curves/nist.js";
import {
  DEFAULT_VERIFY_METADATA_ENDPOINT,
  verifyMetadata,
  type VerifyMetadataCallback,
} from "./metadata.js";

/**
 * Verifies the request against the server.
 *
 * The per-asset URI is no longer stored on-chain, so asset metadata is fetched
 * from a fixed endpoint by default. Pass `verifyMetadataCallback` to override
 * how (and from where) the asset metadata is resolved.
 */
export async function verifyWithServerCheck(
  params: URLSearchParams,
  verifyMetadataCallback: VerifyMetadataCallback = (queryParams) =>
    verifyMetadata(DEFAULT_VERIFY_METADATA_ENDPOINT, queryParams),
) {
  return verifyMetadataCallback(params);
}

export function verifyLocal(params: URLSearchParams) {
  const publicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!publicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const compressedPk = base64URLStringToBuffer(publicKey);
  if (compressedPk.length !== 33) {
    throw new Error(
      `pk must be 33-byte compressed P-256 key, got ${compressedPk.length} bytes`,
    );
  }

  const randomBytes = base64URLStringToBuffer(nonce);
  if (randomBytes.length !== 8) {
    throw new Error(`n must be 8 bytes, got ${randomBytes.length} bytes`);
  }

  const rawSig = base64URLStringToBuffer(signature);
  if (rawSig.length !== 64) {
    throw new Error(
      `s must be 64-byte raw ECDSA signature, got ${rawSig.length} bytes`,
    );
  }

  const currentCounter = Number.parseInt(counter, 10);
  if (
    !Number.isInteger(currentCounter) ||
    currentCounter < 0 ||
    currentCounter > 0xffffffff
  ) {
    throw new Error(`counter out of uint32 range: ${currentCounter}`);
  }

  const counterBytes = getU32Encoder({ endian: Endian.Big }).encode(
    currentCounter,
  );

  const message = new Uint8Array(12);
  message.set(counterBytes, 0);
  message.set(randomBytes, 4);

  const normalizedSig = normalizeSignatureToLowS(rawSig);
  const isVerified = p256.verify(normalizedSig, message, compressedPk);

  return {
    isVerified,
    publicKey,
    counter: currentCounter
  };
}
