import { decodeCbor } from "./cbor.js";

/** WebAuthn authenticator data flags (byte index 32). */
const FLAG_AT = 0x40;
const FLAG_ED = 0x80;

/**
 * Skip one definite CBOR data item (RFC 8949). Used to skip the COSE public key
 * in attested credential data. Indefinite-length items throw (not used in WebAuthn authData).
 */
function skipOneCborItem(buf: Uint8Array, i: number): number {
  const first = buf[i];
  const mt = first >> 5;
  const ai = first & 0x1f;
  let p = i + 1;

  if (mt === 0 || mt === 1) {
    if (ai < 24) {
      return p;
    }
    if (ai === 24) {
      return p + 1;
    }
    if (ai === 25) {
      return p + 2;
    }
    if (ai === 26) {
      return p + 4;
    }
    if (ai === 27) {
      return p + 8;
    }
    throw new Error("CBOR: invalid integer encoding");
  }

  if (mt === 2 || mt === 3) {
    const { len, next } = readLength(ai, buf, p);
    return next + len;
  }

  if (mt === 4) {
    if (ai === 31) {
      throw new Error("CBOR: indefinite array not supported in authData");
    }
    const { len, next } = readLength(ai, buf, p);
    let q = next;
    for (let k = 0; k < len; k++) {
      q = skipOneCborItem(buf, q);
    }
    return q;
  }

  if (mt === 5) {
    if (ai === 31) {
      throw new Error("CBOR: indefinite map not supported in authData");
    }
    const { len, next } = readLength(ai, buf, p);
    let q = next;
    for (let k = 0; k < len; k++) {
      q = skipOneCborItem(buf, q);
      q = skipOneCborItem(buf, q);
    }
    return q;
  }

  if (mt === 6) {
    const { next } = readTagNumber(ai, p);
    return skipOneCborItem(buf, next);
  }

  if (mt === 7) {
    if (ai < 24) {
      return p;
    }
    if (ai === 24) {
      return p + 1;
    }
    if (ai === 25) {
      return p + 2;
    }
    if (ai === 26) {
      return p + 5;
    }
    if (ai === 27) {
      return p + 9;
    }
    throw new Error("CBOR: invalid simple/float encoding");
  }

  throw new Error("CBOR: unknown major type");
}

function readLength(
  ai: number,
  buf: Uint8Array,
  p: number,
): { len: number; next: number } {
  if (ai < 24) {
    return { len: ai, next: p };
  }
  if (ai === 24) {
    return { len: buf[p], next: p + 1 };
  }
  if (ai === 25) {
    return { len: (buf[p] << 8) | buf[p + 1], next: p + 2 };
  }
  if (ai === 26) {
    const len =
      ((buf[p] << 24) |
        (buf[p + 1] << 16) |
        (buf[p + 2] << 8) |
        buf[p + 3]) >>>
      0;
    return { len, next: p + 4 };
  }
  if (ai === 27) {
    const hi =
      (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const lo =
      (buf[p + 4] << 24) |
      (buf[p + 5] << 16) |
      (buf[p + 6] << 8) |
      buf[p + 7];
    const n = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("CBOR: length too large");
    }
    return { len: Number(n), next: p + 8 };
  }
  throw new Error("CBOR: invalid length encoding");
}

function readTagNumber(ai: number, p: number): { next: number } {
  if (ai < 24) {
    return { next: p };
  }
  if (ai === 24) {
    return { next: p + 1 };
  }
  if (ai === 25) {
    return { next: p + 2 };
  }
  if (ai === 26) {
    return { next: p + 4 };
  }
  if (ai === 27) {
    return { next: p + 8 };
  }
  throw new Error("CBOR: invalid tag encoding");
}

/**
 * Advance past attested credential data (starts at `start`, first byte of AAGUID).
 */
function skipAttestedCredentialData(
  authData: Uint8Array,
  start: number,
): number {
  if (authData.length < start + 18) {
    throw new Error("authData: truncated attested credential data header");
  }
  let off = start + 16;
  const credIdLen = (authData[off] << 8) | authData[off + 1];
  off += 2 + credIdLen;
  if (off > authData.length) {
    throw new Error("authData: credential id out of range");
  }
  return skipOneCborItem(authData, off);
}

function cborExtensionsToRecord(decoded: unknown): Record<string, unknown> {
  if (decoded instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of decoded) {
      if (typeof k === "string") {
        o[k] = v;
      }
    }
    return o;
  }
  if (
    decoded !== null &&
    typeof decoded === "object" &&
    !Array.isArray(decoded)
  ) {
    return { ...(decoded as Record<string, unknown>) };
  }
  return {};
}

/**
 * Parse the **extensions** CBOR map from WebAuthn authenticator data (ED flag).
 * This is what browsers merge into `getClientExtensionResults()` for authenticator
 * extension outputs; pure **client** extensions are not present here.
 *
 * @returns Plain object suitable for `clientExtensionResults`, or `{}` if ED is clear.
 */
export function parseAuthenticatorDataExtensions(
  authData: Uint8Array,
): Record<string, unknown> {
  if (authData.length < 37) {
    return {};
  }
  const flags = authData[32];
  let offset = 37;
  if (flags & FLAG_AT) {
    offset = skipAttestedCredentialData(authData, offset);
  }
  if ((flags & FLAG_ED) === 0) {
    return {};
  }
  if (offset >= authData.length) {
    return {};
  }
  const extBytes = authData.subarray(offset);
  const decoded = decodeCbor(extBytes);
  return cborExtensionsToRecord(decoded);
}
