// Vendored from @revibase/ctap2-js.
import {
  FIDO_AID,
  NFC_TX_CHUNK_SIZE,
  SW1_MORE_DATA,
  SW_NO_ERROR,
} from "./constants.js";
import { ApduError } from "./errors.js";

const CLA_CHAIN = 0x10;

/** CTAP2 error codes  */
function formatCtapErrorMessage(code: number): string {
  const hex = `0x${code.toString(16).padStart(2, "0")}`;
  const names: Record<number, string> = {
    0x01: "INVALID_COMMAND",
    0x02: "INVALID_PARAMETER",
    0x03: "INVALID_LENGTH",
    0x11: "CBOR_UNEXPECTED_TYPE",
    0x12: "INVALID_CBOR",
    0x14: "MISSING_PARAMETER",
    0x2e: "NO_CREDENTIALS",
    0x30: "NOT_ALLOWED",
  };
  const name = names[code];
  return name ? `CTAP error ${hex} (${name})` : `CTAP error code ${hex}`;
}

interface ParsedIso7816Response {
  data: Uint8Array;
  sw1: number;
  sw2: number;
  statusWord: number;
}

export interface NfcShortApduSegment {
  bytes: Uint8Array;
  chained: boolean;
}

export function encodeExtendedCase3e(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data: Uint8Array,
): Uint8Array {
  const n = data.length;
  if (n > 65535) {
    throw new ApduError("APDU data field exceeds 65535 bytes");
  }
  const out = new Uint8Array(7 + n + 2);
  out[0] = cla & 0xff;
  out[1] = ins & 0xff;
  out[2] = p1 & 0xff;
  out[3] = p2 & 0xff;
  out[4] = 0x00;
  out[5] = (n >> 8) & 0xff;
  out[6] = n & 0xff;
  out.set(data, 7);
  out[7 + n] = 0x00;
  out[7 + n + 1] = 0x00;
  return out;
}

export function encodeShortApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  payload: Uint8Array,
  options: { chained: boolean },
): Uint8Array {
  const lc = payload.length;
  if (lc > 255) {
    throw new ApduError("short APDU payload must be ≤ 255 bytes");
  }
  const withLe = !options.chained;
  const out = new Uint8Array(5 + lc + (withLe ? 1 : 0));
  out[0] = (cla & 0xff) | (options.chained ? CLA_CHAIN : 0);
  out[1] = ins & 0xff;
  out[2] = p1 & 0xff;
  out[3] = p2 & 0xff;
  out[4] = lc & 0xff;
  out.set(payload, 5);
  if (withLe) {
    out[5 + lc] = 0x00;
  }
  return out;
}

/**
 * Send CTAP CBOR command APDUs
 * Extended APDU in memory is split into short chained frames;
 * Intermediate responses must be SW 0x9000, the last response carries CTAP payload + SW.
 */
export async function transmitCborApduSegments(
  segments: NfcShortApduSegment[],
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  let last: Uint8Array | undefined;
  for (const seg of segments) {
    const resp = await transceive(seg.bytes);
    if (resp.length < 2) {
      throw new ApduError(
        `APDU response too short for status word (${resp.length} byte(s))`,
      );
    }
    const sw = (resp[resp.length - 2] << 8) | resp[resp.length - 1];
    if (seg.chained) {
      if (sw !== SW_NO_ERROR) {
        throw new ApduError(
          `ISO7816 status 0x${sw.toString(16).padStart(4, "0")}`,
        );
      }
    } else {
      last = resp;
    }
  }
  if (!last) {
    throw new ApduError("no final APDU response");
  }
  return last;
}

/** Max GET RESPONSE iterations (matches practical NFC response sizes). */
const GET_RESPONSE_MAX_CHAIN = 256;

/**
 * Follow ISO 7816 "more data" responses for CBOR:
 * while SW1 == 0x61, send GET RESPONSE (CLA 0x80, INS 0xc0, Le = SW2) and
 * concatenate response bodies; final buffer is payload + SW1 + SW2.
 */
export async function collectCborApduResponse(
  firstResponse: Uint8Array,
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let cur = firstResponse;
  for (let i = 0; i < GET_RESPONSE_MAX_CHAIN; i++) {
    if (cur.length < 2) {
      throw new ApduError("APDU response too short");
    }
    const sw1 = cur[cur.length - 2];
    const sw2 = cur[cur.length - 1];
    chunks.push(cur.slice(0, -2));
    if (sw1 !== SW1_MORE_DATA) {
      const totalLen = chunks.reduce((a, c) => a + c.length, 0) + 2;
      const out = new Uint8Array(totalLen);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      out[o] = sw1;
      out[o + 1] = sw2;
      return out;
    }
    cur = await transceive(buildGetResponseApdu(sw2, true));
  }
  throw new ApduError("GET RESPONSE chain exceeded limit");
}

/**
 * Full NFC CTAP2 command exchange for Java Card–style FIDO applets: send short
 * chained command frames ({@link transmitCborApduSegments}), then resolve
 * `61 xx` / GET RESPONSE until `90 00` (same as libfido2 `nfc_do_tx` +
 * `rx_msg`). Use after SELECT.
 */
export async function transceiveNfcCtap2Command(
  segments: NfcShortApduSegment[],
  transceive: (apdu: Uint8Array) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  return collectCborApduResponse(
    await transmitCborApduSegments(segments, transceive),
    transceive,
  );
}

export function splitExtendedApduForNfcTransmit(
  extended: Uint8Array,
  chunkSize: number = NFC_TX_CHUNK_SIZE,
): NfcShortApduSegment[] {
  if (extended.length < 9) {
    throw new ApduError("extended APDU too short");
  }
  const cla = extended[0];
  const ins = extended[1];
  const p1 = extended[2];
  const p2 = extended[3];
  const data = extended.slice(7, extended.length - 2);
  const segments: NfcShortApduSegment[] = [];
  let off = 0;
  while (data.length - off > chunkSize) {
    const chunk = data.subarray(off, off + chunkSize);
    segments.push({
      bytes: encodeShortApdu(cla, ins, p1, p2, chunk, { chained: true }),
      chained: true,
    });
    off += chunkSize;
  }
  const rest = data.subarray(off);
  segments.push({
    bytes: encodeShortApdu(cla, ins, p1, p2, rest, { chained: false }),
    chained: false,
  });
  return segments;
}

export function buildSelectFidoApdu(): Uint8Array {
  return encodeExtendedCase3e(0x00, 0xa4, 0x04, 0x00, FIDO_AID);
}

/** Short APDU(s) for SELECT — preferred over {@link buildSelectFidoApdu} on NFC. */
export function buildSelectFidoApduSegments(): NfcShortApduSegment[] {
  return splitExtendedApduForNfcTransmit(buildSelectFidoApdu());
}

export function buildCborCommandApdu(cborPayload: Uint8Array): Uint8Array {
  return encodeExtendedCase3e(0x80, 0x10, 0x00, 0x00, cborPayload);
}

export function buildGetResponseApdu(le: number, cbor: boolean): Uint8Array {
  const apdu = new Uint8Array(5);
  apdu[0] = cbor ? 0x80 : 0x00;
  apdu[1] = 0xc0;
  apdu[2] = 0x00;
  apdu[3] = 0x00;
  apdu[4] = le & 0xff;
  return apdu;
}

export function parseIso7816Response(buf: Uint8Array): ParsedIso7816Response {
  if (buf.length < 2) {
    throw new ApduError("response must include SW1 and SW2");
  }
  const sw1 = buf[buf.length - 2];
  const sw2 = buf[buf.length - 1];
  const statusWord = (sw1 << 8) | sw2;
  return {
    data: buf.slice(0, -2),
    sw1,
    sw2,
    statusWord,
  };
}

function isSuccessStatus(statusWord: number): boolean {
  return statusWord === SW_NO_ERROR;
}

type ParseCtaphidCborBodyResult =
  | { ok: true; cborMapBytes: Uint8Array }
  | { ok: false; layer: "iso7816"; statusWord: number }
  | { ok: false; layer: "ctap"; errorCode: number };

export function parseCtaphidCborFromApduResponse(
  apduResponseIncludingSw: Uint8Array,
): ParseCtaphidCborBodyResult {
  const { data, statusWord } = parseIso7816Response(apduResponseIncludingSw);
  if (!isSuccessStatus(statusWord)) {
    return { ok: false, layer: "iso7816", statusWord };
  }
  if (data.length < 1) {
    throw new ApduError("empty CTAP payload after ISO7816 success");
  }
  const status = data[0];
  if (status !== 0) {
    return { ok: false, layer: "ctap", errorCode: status };
  }
  return { ok: true, cborMapBytes: data.subarray(1) };
}

export function unwrapCtaphidCborBody(
  parsed: ParseCtaphidCborBodyResult,
): Uint8Array {
  if (!parsed.ok) {
    if (parsed.layer === "iso7816") {
      throw new ApduError(
        `ISO7816 status 0x${parsed.statusWord.toString(16).padStart(4, "0")}`,
      );
    }
    throw new ApduError(formatCtapErrorMessage(parsed.errorCode));
  }
  return parsed.cborMapBytes;
}
