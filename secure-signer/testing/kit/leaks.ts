/**
 * Secret-leak scanner. Register secret byte strings (PRF outputs, seeds,
 * exported keys), then scan anything that crossed a trust boundary: posted
 * messages, HTTP bodies, storage. Every common textual encoding is checked.
 */

import { toBase64, toBase64Url, toHex, toLatin1 } from "./bytes.js";

export interface LeakFinding {
  secret: string;
  where: string;
  encoding: string;
}

function encodings(bytes: Uint8Array): Array<[string, string]> {
  const hex = toHex(bytes);
  const out: Array<[string, string]> = [
    ["hex", hex],
    ["HEX", hex.toUpperCase()],
    ["base64", toBase64(bytes).replace(/=+$/, "")],
    ["base64url", toBase64Url(bytes)],
    ["json-array", JSON.stringify(Array.from(bytes)).slice(1, -1)],
    ["latin1", toLatin1(bytes)],
  ];
  return out.filter(([, v]) => v.length >= 16);
}

/** Serialize an arbitrary value so byte buffers become scannable text. */
export function flatten(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): string => {
    if (v == null) return String(v);
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") {
      return String(v);
    }
    if (v instanceof Uint8Array) {
      return `${toHex(v)} ${toBase64(v)} ${toBase64Url(v)} ${toLatin1(v)} ${Array.from(v).join(",")}`;
    }
    if (v instanceof ArrayBuffer) return walk(new Uint8Array(v));
    if (ArrayBuffer.isView(v)) {
      return walk(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    }
    if (typeof v === "object") {
      if (seen.has(v)) return "";
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk).join(" ");
      return Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => `${k}:${walk(val)}`)
        .join(" ");
    }
    return "";
  };
  return walk(value);
}

export class LeakScanner {
  private readonly secrets = new Map<string, Uint8Array>();

  track(label: string, bytes: Uint8Array): this {
    if (bytes.length === 0) throw new Error("empty secret");
    this.secrets.set(label, bytes.slice());
    return this;
  }

  scan(where: string, value: unknown): LeakFinding[] {
    const text = flatten(value);
    const findings: LeakFinding[] = [];
    for (const [secret, bytes] of this.secrets) {
      for (const [encoding, enc] of encodings(bytes)) {
        if (text.includes(enc)) findings.push({ secret, where, encoding });
      }
    }
    return findings;
  }

  scanAll(items: ReadonlyArray<{ where: string; value: unknown }>): LeakFinding[] {
    return items.flatMap((i) => this.scan(i.where, i.value));
  }
}
