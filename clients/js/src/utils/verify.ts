import { Endian, getU32Encoder } from "@solana/kit";
import { base64URLStringToBuffer } from "./encoding";
import { DEFAULT_CARD_METADATA_ENDPOINT } from "./consts";

/** Length (bytes) of the message the NFC tag signs: `counter(4 BE) || nonce(8)`. */
export const TAP_MESSAGE_LEN = 12;

/**
 * Parsed and validated contents of a dynamic-URL tap. The tag signs a fixed
 * `counter(4 BE) || nonce(8)` message; the signature is raw 64-byte ECDSA over P-256.
 */
export type TapSignature = {
  /** 33-byte compressed P-256 public key. */
  compressedPubkey: Uint8Array;
  /** 64-byte raw `r || s` ECDSA signature. */
  signature: Uint8Array;
  /** The exact 12-byte message that was signed (`counter || nonce`). */
  message: Uint8Array;
  /** Monotonic tap counter, parsed from the message. */
  counter: number;
};

/**
 * Validates the `pk`/`s`/`c`/`n` params of a dynamic NDEF URL and reconstructs the
 * signed message. Shared by server verification and the on-chain instruction builders.
 */
export function parseTapSignature(params: URLSearchParams): TapSignature {
  const publicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!publicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const compressedPubkey = base64URLStringToBuffer(publicKey);
  if (compressedPubkey.length !== 33) {
    throw new Error(
      `pk must be 33-byte compressed P-256 key, got ${compressedPubkey.length} bytes`,
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

  const message = new Uint8Array(TAP_MESSAGE_LEN);
  message.set(counterBytes, 0);
  message.set(randomBytes, 4);

  return {
    compressedPubkey,
    signature: rawSig,
    message,
    counter: currentCounter,
  };
}

/**
 * Card identity and freshness resolved by the verifying server for a given tap.
 * `latestCounter` is the highest counter the server has recorded for this card.
 */
export type CardMetadata = {
  secp256r1PublicKey: string;
  credentialId: string | null;
  expiry: number | null;
  latestCounter: number;
};

/** Resolves a tap's card metadata from a server, given the dynamic-URL params. */
export type CardMetadataFetcher = (
  params: URLSearchParams,
) => Promise<CardMetadata>;

/**
 * Verifies a tapped NDEF dynamic URL against a server.
 *
 * The server resolves the card metadata for the supplied params and is the authority on
 * freshness: it throws if the tap's counter is not greater than the latest counter it has
 * stored for this card. By default a fixed endpoint is used; pass `fetchCardMetadata` to
 * route the check through your own backend.
 */
export async function verify(
  params: URLSearchParams,
  fetchCardMetadata: CardMetadataFetcher = defaultFetchCardMetadata,
): Promise<CardMetadata> {
  // Surface malformed taps locally before involving the server.
  parseTapSignature(params);
  return fetchCardMetadata(params);
}

async function defaultFetchCardMetadata(
  params: URLSearchParams,
): Promise<CardMetadata> {
  const url = new URL(DEFAULT_CARD_METADATA_ENDPOINT);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `Card verification failed (${response.status})`,
    );
  }
  return (await response.json()) as CardMetadata;
}
