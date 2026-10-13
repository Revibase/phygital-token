/**
 * Permission requests: a project asks an accessory's owner to allow what its
 * app needs, through a link or QR code. The request rides in the URL fragment
 * (deflated, base64url), so it never reaches a server; or the link points at
 * JSON on the project's own site (`?src=`), which then names that site. The
 * owner picks the accessory, and the Revibase app shows only what would change.
 */
import { parsePermissionSet, PermissionFormatError, type PermissionSet } from "./format.js";

export const PERMISSIONS_URL = "https://portal.revibase.com/permissions";
/** Compressed payload cap, comfortably within a scannable QR code. */
export const MAX_REQUEST_BYTES = 4096;
/** Uncompressed cap, so a tiny payload can't inflate into something huge. */
const MAX_JSON_BYTES = 64 * 1024;

async function pipeThrough(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  max: number,
): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new PermissionFormatError("request", "is too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  chunks.reduce((at, c) => (out.set(c, at), at + c.length), 0);
  return out;
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s))
    throw new PermissionFormatError("request", "is not valid base64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** A link (and the text of its QR code) asking the owner to allow `set`. */
export async function encodePermissionRequest(
  set: PermissionSet,
  base = PERMISSIONS_URL,
): Promise<string> {
  const checked = parsePermissionSet(set);
  const json = new TextEncoder().encode(JSON.stringify(checked));
  if (json.length > MAX_JSON_BYTES) throw new PermissionFormatError("request", "is too large");
  const deflated = await pipeThrough(json, new CompressionStream("deflate-raw"), MAX_REQUEST_BYTES);
  return `${base}#r=${toBase64Url(deflated)}`;
}

/** Reads a request link's fragment payload (the `r=` value, or the whole link). */
export async function decodePermissionRequest(linkOrPayload: string): Promise<PermissionSet> {
  const hash = linkOrPayload.includes("#")
    ? linkOrPayload.slice(linkOrPayload.indexOf("#") + 1)
    : linkOrPayload;
  const payload = new URLSearchParams(hash).get("r") ?? hash;
  if (payload.length > Math.ceil((MAX_REQUEST_BYTES * 4) / 3))
    throw new PermissionFormatError("request", "is too large");
  const bytes = fromBase64Url(payload);
  if (bytes.length > MAX_REQUEST_BYTES) throw new PermissionFormatError("request", "is too large");
  const json = await pipeThrough(
    bytes,
    new DecompressionStream("deflate-raw"),
    MAX_JSON_BYTES,
  ).catch((err) => {
    if (err instanceof PermissionFormatError) throw err;
    throw new PermissionFormatError("request", "couldn't be read");
  });
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new PermissionFormatError("request", "is not valid JSON");
  }
  return parsePermissionSet(value);
}

/** A request hosted by the project (`?src=`): HTTPS only, size-capped, strictly parsed. */
export async function fetchPermissionRequest(
  src: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ set: PermissionSet; site: string }> {
  const url = new URL(src);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new PermissionFormatError("src", "must be an https link");
  const res = await fetchImpl(url.href, { credentials: "omit", redirect: "error" });
  if (!res.ok) throw new PermissionFormatError("src", `couldn't be loaded (${res.status})`);
  if (!res.body) throw new PermissionFormatError("src", "is empty");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new PermissionFormatError("src", "is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  chunks.reduce((at, chunk) => (bytes.set(chunk, at), at + chunk.length), 0);
  const text = new TextDecoder().decode(bytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PermissionFormatError("src", "is not valid JSON");
  }
  return { set: parsePermissionSet(value), site: url.host };
}
