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
import {
  findCardInstancePda,
  parseSecp256r1Pubkey,
} from "../instructions/mint";
import { fetchCardInstance } from "../generated";
import { fetchCardMetadata } from "./metadata";

export async function verifyWithServerCheck(
  rpc: Rpc<SolanaRpcApi>,
  params: URLSearchParams,
) {
  const publicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!publicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const secp256r1PubKey = parseSecp256r1Pubkey(publicKey);
  const cardInfo = await fetchCardInstance(
    rpc,
    await findCardInstancePda(secp256r1PubKey),
  );
  const result = await fetchCardMetadata(cardInfo.data.uri, params);
  return result;
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

  return {
    isVerified: p256.verify(rawSig, message, compressedPk),
    publicKey,
    currentCounter,
  };
}
