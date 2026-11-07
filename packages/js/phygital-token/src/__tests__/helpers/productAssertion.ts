import { p256 } from "@noble/curves/nist.js";

import { buildProductAllowListId } from "../../utils/passkey/productKey.js";
import { toBase64URL, type AuthenticationResponseJSON } from "../../utils/passkey/webauthn.js";

/** The card's large blob: `a2 01 58 21 <pubkey> 02 58 <len> <der>`. */
export function encodeProductLargeBlob(
  publicKey: Uint8Array,
  signatureDer: Uint8Array,
): Uint8Array {
  return Uint8Array.from([
    0xa2,
    0x01,
    0x58,
    publicKey.length,
    ...publicKey,
    0x02,
    0x58,
    signatureDer.length,
    ...signatureDer,
  ]);
}

/** A tap as the card returns it: only the large blob is meaningful. */
export function tapResponse(blob: Uint8Array): AuthenticationResponseJSON {
  const empty = toBase64URL(new Uint8Array(0));
  return {
    id: empty,
    rawId: empty,
    type: "public-key",
    clientExtensionResults: { largeBlob: { blob: toBase64URL(blob) } },
    response: { clientDataJSON: empty, authenticatorData: empty, signature: empty },
  };
}

/** A tap where the card's key signed `authorize || payload`, high-S if asked (the card doesn't normalize). */
export function buildProductAssertion(args: {
  privateKey: Uint8Array;
  payload: Uint8Array;
  highS?: boolean;
}): { response: AuthenticationResponseJSON; publicKey: Uint8Array; message: Uint8Array } {
  const publicKey = p256.getPublicKey(args.privateKey, true);
  const message = buildProductAllowListId(args.payload);
  let sig = p256.Signature.fromBytes(p256.sign(message, args.privateKey), "compact");
  if (args.highS && !sig.hasHighS()) sig = new p256.Signature(sig.r, p256.Point.CURVE().n - sig.s);
  return {
    response: tapResponse(encodeProductLargeBlob(publicKey, sig.toBytes("der"))),
    publicKey,
    message,
  };
}
