// Minimal CBOR (RFC 8949) encoder/decoder for the CTAP2 getAssertion path.
//
// Vendored in place of `cbor-x` so the NFC verification path has no external
// CBOR dependency. Only the subset CTAP2/FIDO2 needs is implemented:
//   encode: unsigned/negative ints, byte strings, text strings, arrays,
//           maps (number- or string-keyed), booleans, null — in CTAP2
//           canonical key order.
//   decode: the above, plus tags (transparently unwrapped) and 64-bit ints
//           (as bigint when outside the safe integer range). Indefinite-length
//           items and floats are rejected (CTAP2 applets do not emit them).

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * CTAP2 canonical CBOR key order for text-string map keys (FIDO CTAP §8):
 * shorter UTF-8 length sorts first; same length → lower byte-wise lexical order.
 */
function compareCtapTextMapKeys(a: string, b: string): number {
  const ab = textEncoder.encode(a);
  const bb = textEncoder.encode(b);
  if (ab.length !== bb.length) {
    return ab.length - bb.length;
  }
  for (let i = 0; i < ab.length; i++) {
    if (ab[i] !== bb[i]) {
      return ab[i] - bb[i];
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function pushHead(out: number[], major: number, n: number): void {
  const mt = major << 5;
  if (n < 24) {
    out.push(mt | n);
  } else if (n < 0x100) {
    out.push(mt | 24, n);
  } else if (n < 0x10000) {
    out.push(mt | 25, (n >> 8) & 0xff, n & 0xff);
  } else if (n < 0x100000000) {
    out.push(
      mt | 26,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    );
  } else {
    const hi = Math.floor(n / 0x100000000);
    const lo = n % 0x100000000;
    out.push(
      mt | 27,
      (hi >>> 24) & 0xff,
      (hi >>> 16) & 0xff,
      (hi >>> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff,
    );
  }
}

function asUint8Array(v: ArrayBufferView): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function sortedEntries(value: object): Array<[number | string, unknown]> {
  if (value instanceof Map) {
    const keys = [...value.keys()];
    if (keys.every((k) => typeof k === "number")) {
      return (keys as number[])
        .slice()
        .sort((a, b) => a - b)
        .map((k) => [k, value.get(k)]);
    }
    if (keys.every((k) => typeof k === "string")) {
      return (keys as string[])
        .slice()
        .sort(compareCtapTextMapKeys)
        .map((k) => [k, value.get(k)]);
    }
    throw new Error("CTAP CBOR: map keys must be all numbers or all strings");
  }
  const o = value as Record<string, unknown>;
  return Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort(compareCtapTextMapKeys)
    .map((k) => [k, o[k]]);
}

function encodeValue(value: unknown, out: number[]): void {
  if (value === null || value === undefined) {
    out.push(0xf6);
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xf5 : 0xf4);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error("CTAP CBOR: only integer numbers are supported");
    }
    if (value >= 0) {
      pushHead(out, 0, value);
    } else {
      pushHead(out, 1, -value - 1);
    }
    return;
  }
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error("CTAP CBOR: negative bigint not supported");
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("CTAP CBOR: bigint exceeds safe integer range");
    }
    pushHead(out, 0, Number(value));
    return;
  }
  if (typeof value === "string") {
    const bytes = textEncoder.encode(value);
    pushHead(out, 3, bytes.length);
    for (const b of bytes) out.push(b);
    return;
  }
  if (value instanceof Uint8Array) {
    pushHead(out, 2, value.length);
    for (const b of value) out.push(b);
    return;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const bytes = asUint8Array(value);
    pushHead(out, 2, bytes.length);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(value)) {
    pushHead(out, 4, value.length);
    for (const item of value) encodeValue(item, out);
    return;
  }
  if (typeof value === "object") {
    const entries = sortedEntries(value as object);
    pushHead(out, 5, entries.length);
    for (const [k, v] of entries) {
      encodeValue(k, out);
      encodeValue(v, out);
    }
    return;
  }
  throw new Error(`CTAP CBOR: unsupported value type ${typeof value}`);
}

export function encodeCtapCbor(value: unknown): Uint8Array {
  const out: number[] = [];
  encodeValue(value, out);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

function readArg(buf: Uint8Array, ai: number, p: number): [number | bigint, number] {
  if (ai < 24) return [ai, p];
  if (ai === 24) return [buf[p], p + 1];
  if (ai === 25) return [(buf[p] << 8) | buf[p + 1], p + 2];
  if (ai === 26) {
    const n =
      ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>>
      0;
    return [n, p + 4];
  }
  if (ai === 27) {
    const hi =
      ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>>
      0;
    const lo =
      ((buf[p + 4] << 24) |
        (buf[p + 5] << 16) |
        (buf[p + 6] << 8) |
        buf[p + 7]) >>>
      0;
    const big = (BigInt(hi) << 32n) | BigInt(lo);
    const n = big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
    return [n, p + 8];
  }
  throw new Error("CBOR: indefinite-length items are not supported");
}

function decodeItem(buf: Uint8Array, p: number): [unknown, number] {
  if (p >= buf.length) {
    throw new Error("CBOR: unexpected end of input");
  }
  const first = buf[p];
  const mt = first >> 5;
  const ai = first & 0x1f;
  const [argRaw, p1] = readArg(buf, ai, p + 1);

  switch (mt) {
    case 0:
      return [argRaw, p1];
    case 1:
      return [
        typeof argRaw === "bigint" ? -1n - argRaw : -1 - argRaw,
        p1,
      ];
    case 2: {
      const len = Number(argRaw);
      return [buf.slice(p1, p1 + len), p1 + len];
    }
    case 3: {
      const len = Number(argRaw);
      return [textDecoder.decode(buf.subarray(p1, p1 + len)), p1 + len];
    }
    case 4: {
      const len = Number(argRaw);
      const arr: unknown[] = [];
      let q = p1;
      for (let i = 0; i < len; i++) {
        const [v, q2] = decodeItem(buf, q);
        arr.push(v);
        q = q2;
      }
      return [arr, q];
    }
    case 5: {
      const len = Number(argRaw);
      const entries: Array<[unknown, unknown]> = [];
      let allStringKeys = true;
      let q = p1;
      for (let i = 0; i < len; i++) {
        const [k, q2] = decodeItem(buf, q);
        const [v, q3] = decodeItem(buf, q2);
        if (typeof k !== "string") allStringKeys = false;
        entries.push([k, v]);
        q = q3;
      }
      if (allStringKeys) {
        const obj: Record<string, unknown> = {};
        for (const [k, v] of entries) obj[k as string] = v;
        return [obj, q];
      }
      const m = new Map<unknown, unknown>();
      for (const [k, v] of entries) m.set(k, v);
      return [m, q];
    }
    case 6: {
      // Tag: decode and transparently return the tagged content.
      return decodeItem(buf, p1);
    }
    case 7: {
      if (ai === 20) return [false, p1];
      if (ai === 21) return [true, p1];
      if (ai === 22) return [null, p1];
      if (ai === 23) return [undefined, p1];
      throw new Error("CBOR: floats/simple values are not supported");
    }
    default:
      throw new Error(`CBOR: unknown major type ${mt}`);
  }
}

export function decodeCbor(buf: Uint8Array): unknown {
  const [value] = decodeItem(buf, 0);
  return value;
}

// ---------------------------------------------------------------------------
// Helpers used by the assertion decoder
// ---------------------------------------------------------------------------

export function bytesView(v: unknown): Uint8Array | undefined {
  if (v instanceof Uint8Array) {
    return new Uint8Array(v);
  }
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return asUint8Array(v as ArrayBufferView);
  }
  return undefined;
}

export function cborMapGet(
  map: Map<number, unknown> | object,
  key: number,
): unknown {
  if (map instanceof Map) {
    return map.get(key);
  }
  if (map !== null && typeof map === "object") {
    const o = map as Record<number | string, unknown>;
    if (key in o) {
      return o[key];
    }
    const s = String(key);
    if (s in o) {
      return o[s];
    }
  }
  return undefined;
}
