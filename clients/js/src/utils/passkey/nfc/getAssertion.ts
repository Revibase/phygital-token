// Vendored from @revibase/ctap2-js (getAssertion only).
import {
  parseCtaphidCborFromApduResponse,
  unwrapCtaphidCborBody,
} from "./apdu.js";
import { CTAP_CBOR_ASSERT } from "./constants.js";
import { ApduError } from "./errors.js";
import { bytesView, cborMapGet, decodeCbor, encodeCtapCbor } from "./cbor.js";

export interface AuthenticatorGetAssertionRequest {
  rpId: string;
  clientDataHash: Uint8Array;
  allowCredentials?: Array<{ id: Uint8Array; type?: string }>;
  extensions?: Record<string, unknown>;
  options?: { up?: boolean; uv?: boolean };
}

export interface AuthenticatorGetAssertionResponse {
  credential?: {
    id: Uint8Array;
    type?: string;
  };
  authData: Uint8Array;
  signature: Uint8Array;
  user?: {
    id: Uint8Array;
    name?: string;
    displayName?: string;
    icon?: string;
  };
  numberOfCredentials?: number;
  largeBlobKey?: Uint8Array;
}

function buildRequestMap(
  req: AuthenticatorGetAssertionRequest,
): Map<number, unknown> {
  const m = new Map<number, unknown>();
  m.set(1, req.rpId);
  m.set(2, req.clientDataHash);
  if (req.allowCredentials?.length) {
    m.set(
      3,
      req.allowCredentials.map((c) => ({
        id: c.id,
        type: c.type ?? "public-key",
      })),
    );
  }
  if (req.extensions && Object.keys(req.extensions).length > 0) {
    m.set(4, req.extensions);
  }
  if (
    req.options &&
    (req.options.up !== undefined || req.options.uv !== undefined)
  ) {
    const opt: Record<string, boolean> = {};
    if (req.options.up !== undefined) {
      opt.up = req.options.up;
    }
    if (req.options.uv !== undefined) {
      opt.uv = req.options.uv;
    }
    m.set(5, opt);
  }
  return m;
}

function decodeAssertionMap(
  decoded: Map<number, unknown> | object,
): AuthenticatorGetAssertionResponse {
  const authData = bytesView(cborMapGet(decoded, 2));
  const signature = bytesView(cborMapGet(decoded, 3));
  if (!authData || !signature) {
    throw new ApduError("missing authData (2) or signature (3) in response");
  }
  const out: AuthenticatorGetAssertionResponse = {
    authData,
    signature,
  };

  const credRaw = cborMapGet(decoded, 1);
  if (credRaw !== null && typeof credRaw === "object") {
    const o = credRaw as Record<string, unknown>;
    const id = bytesView(o.id);
    if (id) {
      out.credential = {
        id,
        type: typeof o.type === "string" ? o.type : undefined,
      };
    }
  }

  const userRaw = cborMapGet(decoded, 4);
  if (userRaw !== null && typeof userRaw === "object") {
    const o = userRaw as Record<string, unknown>;
    const id = bytesView(o.id);
    if (id) {
      out.user = {
        id,
        name: typeof o.name === "string" ? o.name : undefined,
        displayName:
          typeof o.displayName === "string" ? o.displayName : undefined,
        icon: typeof o.icon === "string" ? o.icon : undefined,
      };
    }
  }

  const nRaw = cborMapGet(decoded, 5);
  let n: number | undefined;
  if (typeof nRaw === "number" && Number.isFinite(nRaw)) {
    n = Math.trunc(nRaw);
  } else if (typeof nRaw === "bigint") {
    n = Number(nRaw);
  }
  if (n !== undefined) {
    out.numberOfCredentials = n;
  }

  const lbk = bytesView(cborMapGet(decoded, 7));
  if (lbk) {
    out.largeBlobKey = lbk;
  }
  return out;
}

export function encodeAuthenticatorGetAssertionRequest(
  req: AuthenticatorGetAssertionRequest,
): Uint8Array {
  if (req.clientDataHash.length !== 32) {
    throw new ApduError("clientDataHash must be 32 bytes (SHA-256)");
  }
  const enc = encodeCtapCbor(buildRequestMap(req));
  const frame = new Uint8Array(1 + enc.length);
  frame[0] = CTAP_CBOR_ASSERT;
  frame.set(enc, 1);
  return frame;
}

export function parseAuthenticatorGetAssertionResponse(
  apduResponseIncludingSw: Uint8Array,
): AuthenticatorGetAssertionResponse {
  const cborMapBytes = unwrapCtaphidCborBody(
    parseCtaphidCborFromApduResponse(apduResponseIncludingSw),
  );
  const decoded = decodeCbor(cborMapBytes) as Map<number, unknown> | object;
  return decodeAssertionMap(decoded);
}
