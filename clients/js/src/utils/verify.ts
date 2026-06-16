import {
  Endian,
  getBase64Encoder,
  getU32Decoder,
  getU32Encoder,
  Rpc,
  SolanaRpcApi,
} from "@solana/kit";
import { base64URLStringToBuffer } from "./passkey/internal";
import { p256 } from "@noble/curves/nist.js";
import { parseSecp256r1Pubkey } from "../instructions/mint";
import {
  DEFAULT_VERIFY_METADATA_ENDPOINT,
  verifyMetadata,
  type VerifyMetadataCallback,
} from "./metadata";

let runningCounterMap = new Map<string, number>();

/**
 * Verifies the request against the server.
 *
 * The per-card URI is no longer stored on-chain, so card metadata is fetched
 * from a fixed endpoint by default. Pass `fetchCardMetadataCallback` to override
 * how (and from where) the card metadata is resolved.
 */
export async function verifyWithServerCheck(
  params: URLSearchParams,
  verifyMetadataCallback: VerifyMetadataCallback = (queryParams) =>
    verifyMetadata(DEFAULT_VERIFY_METADATA_ENDPOINT, queryParams),
) {
  const localResult = verifyLocal(params);
  if (!localResult.isVerified) {
    return localResult;
  }

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

  if (
    currentCounter <
    (runningCounterMap.get(publicKey) ?? Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(`Counter is already used. Tap to verify again.`);
  }

  const counterBytes = getU32Encoder({ endian: Endian.Big }).encode(
    currentCounter,
  );

  const message = new Uint8Array(12);
  message.set(counterBytes, 0);
  message.set(randomBytes, 4);

  const isVerified = p256.verify(rawSig, message, compressedPk);

  if (isVerified) {
    runningCounterMap.set(publicKey, currentCounter);
  }

  return {
    isVerified,
    publicKey,
  };
}
