/**
 * Deterministic software WebAuthn authenticator for headless tests.
 *
 * Produces real, verifiable ceremonies (P-256 / ES256, `none` attestation,
 * spec-shaped clientDataJSON and authenticatorData) so the code under test and
 * the server-side verifiers run unmodified. It also implements the PRF
 * extension with CTAP2 hmac-secret semantics, and exposes fault injection for
 * the failure modes a real authenticator or browser can produce.
 *
 * It stands in for `navigator.credentials` only. Everything that consumes its
 * output (signer PRF pipeline, @simplewebauthn/server, on-chain secp256r1
 * verify) stays real.
 */

import { p256 } from "@noble/curves/nist.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  bytesEqual,
  concatBytes,
  toArrayBuffer,
  toBase64Url,
  toBytes as copyBytes,
  utf8,
  type Bytesish,
} from "./bytes.js";
import { cborEncode, type CborValue } from "./cbor.js";

// -----------------------------------------------------------------------------
// Structural WebAuthn types. A subset of the DOM shapes, declared here so the
// kit typechecks in non-DOM programs (the Workers-typed api). DOM option
// objects are assignable to these; consumers in DOM programs cast the returned
// credentials to `PublicKeyCredential` where needed.
// -----------------------------------------------------------------------------

export interface VaCredentialDescriptor {
  type: string;
  id: Bytesish;
  transports?: readonly string[];
}

export interface VaCreateOptions {
  publicKey?: {
    challenge: Bytesish;
    rp: { id?: string; name: string };
    user: { id: Bytesish; name: string; displayName: string };
    pubKeyCredParams: ReadonlyArray<{ type: string; alg: number }>;
    authenticatorSelection?: {
      residentKey?: string;
      requireResidentKey?: boolean;
      userVerification?: string;
      authenticatorAttachment?: string;
    };
    excludeCredentials?: readonly VaCredentialDescriptor[];
    extensions?: unknown;
    timeout?: number;
    attestation?: string;
  };
  signal?: AbortSignal;
}

export interface VaGetOptions {
  publicKey?: {
    challenge: Bytesish;
    rpId?: string;
    allowCredentials?: readonly VaCredentialDescriptor[];
    userVerification?: string;
    extensions?: unknown;
    timeout?: number;
  };
  signal?: AbortSignal;
  mediation?: string;
}

export interface VaAttestationResponse {
  clientDataJSON: ArrayBuffer;
  attestationObject: ArrayBuffer;
  getTransports(): string[];
  getAuthenticatorData(): ArrayBuffer;
  getPublicKey(): ArrayBuffer;
  getPublicKeyAlgorithm(): number;
}

export interface VaAssertionResponse {
  clientDataJSON: ArrayBuffer;
  authenticatorData: ArrayBuffer;
  signature: ArrayBuffer;
  userHandle: ArrayBuffer | null;
}

export interface VaCredential<R> {
  id: string;
  rawId: ArrayBuffer;
  type: "public-key";
  authenticatorAttachment: "platform";
  response: R;
  getClientExtensionResults(): Record<string, unknown>;
}

export type WebAuthnFault =
  "NotAllowedError" | "AbortError" | "InvalidStateError" | "SecurityError" | "NotSupportedError";

export type CeremonyKind = "create" | "get";

export interface VirtualCredential {
  /** Raw credential id. */
  id: Uint8Array;
  rpId: string;
  userHandle: Uint8Array;
  /** P-256 secret scalar (32 bytes). */
  privateKey: Uint8Array;
  /** Uncompressed SEC1 public key (65 bytes). */
  publicKey: Uint8Array;
  signCount: number;
  /** hmac-secret CredRandom; null when the credential has no PRF support. */
  prfSecret: Uint8Array | null;
  discoverable: boolean;
  /**
   * An NFC accessory chip: answers any get() while presented to the reader,
   * whatever the allowCredentials / RP ID (the chip is not origin-bound).
   */
  nfcAccessory?: boolean;
}

/** One-shot mutations applied to the next ceremony's output. */
export interface Tamper {
  /** Sign a different message, so the (well-formed) signature does not verify. */
  signature?: boolean;
  /** Put a different challenge in clientDataJSON than the caller supplied. */
  challenge?: Uint8Array;
  /** Report a different origin in clientDataJSON. */
  origin?: string;
  /** Hash a different RP ID into authenticatorData. */
  rpId?: string;
  /** Clear the user-verified flag. */
  uv?: false;
  /** Clear the user-present flag. */
  up?: false;
  /** Report a different clientData type (e.g. "webauthn.create" on a get). */
  type?: string;
}

export interface VirtualAuthenticatorOptions {
  /** Seed for every key and credential id. Same seed ⇒ same credentials. */
  seed?: string;
  /** Whether new credentials support PRF (hmac-secret). Default true. */
  prf?: boolean;
  /** Return PRF results during create() when eval is requested. Default false (most platforms). */
  prfAtCreate?: boolean;
  /** "increment" (hardware keys) or "zero" (synced passkeys never count). Default "increment". */
  counter?: "increment" | "zero";
  /** Whether the authenticator can perform user verification. Default true. */
  userVerification?: boolean;
}

export interface CeremonyContext {
  /** The web origin the ceremony runs in, e.g. "https://signer.revibase.com". */
  origin: string;
  /**
   * The top-level origin when the ceremony runs in a frame. A different one
   * marks the ceremony cross-origin, as browsers record in clientDataJSON.
   */
  topOrigin?: string;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const PRF_LABEL = utf8("WebAuthn PRF");
const AAGUID = new Uint8Array(16);

function toBytes(source: Bytesish | undefined | null): Uint8Array | null {
  return source == null ? null : copyBytes(source);
}

function domError(name: WebAuthnFault, message: string = name): DOMException {
  return new DOMException(message, name);
}

function hostnameOf(origin: string): string {
  return new URL(origin).hostname;
}

function rpIdAllowed(origin: string, rpId: string): boolean {
  const host = hostnameOf(origin);
  return host === rpId || host.endsWith(`.${rpId}`);
}

function u32be(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

/** WebAuthn PRF → CTAP2 hmac-secret salt transform (WebAuthn L3 §10.1.4). */
export function prfSaltFor(input: Uint8Array): Uint8Array {
  return sha256(concatBytes(PRF_LABEL, Uint8Array.of(0), input));
}

export class VirtualAuthenticator {
  readonly calls = { create: 0, get: 0 };

  private readonly seed: Uint8Array;
  private readonly opts: Required<VirtualAuthenticatorOptions>;
  private readonly store = new Map<string, VirtualCredential>();
  private nonce = 0;
  private faults: Array<{ fault: WebAuthnFault; op: CeremonyKind | "any" }> = [];
  private tampers: Tamper[] = [];
  private preferred: Uint8Array | null = null;
  private presented: Uint8Array | null = null;
  private last: VaCredential<VaAssertionResponse> | null = null;

  constructor(options: VirtualAuthenticatorOptions = {}) {
    this.opts = {
      seed: options.seed ?? "virtual-authenticator",
      prf: options.prf ?? true,
      prfAtCreate: options.prfAtCreate ?? false,
      counter: options.counter ?? "increment",
      userVerification: options.userVerification ?? true,
    };
    this.seed = sha256(utf8(this.opts.seed));
  }

  // ---------------------------------------------------------------------------
  // Fault injection + inspection
  // ---------------------------------------------------------------------------

  /** Reject the next matching ceremony with a DOMException of this name. */
  failNext(fault: WebAuthnFault, op: CeremonyKind | "any" = "any"): this {
    this.faults.push({ fault, op });
    return this;
  }

  /** Mutate the next ceremony's output (see {@link Tamper}). */
  tamperNext(t: Tamper): this {
    this.tampers.push(t);
    return this;
  }

  /** For discoverable get(): which credential the "user" picks next. */
  selectNext(credentialId: Uint8Array): this {
    this.preferred = credentialId;
    return this;
  }

  /** Every credential currently held, oldest first. */
  list(): VirtualCredential[] {
    return [...this.store.values()];
  }

  credential(id: Uint8Array): VirtualCredential | undefined {
    return this.store.get(toBase64Url(id));
  }

  /** Simulate the user deleting the passkey from their device. */
  removeCredential(id: Uint8Array): boolean {
    return this.store.delete(toBase64Url(id));
  }

  /** Disable PRF on an existing credential (e.g. a non-PRF platform). */
  disablePrf(id: Uint8Array): void {
    const c = this.credential(id);
    if (c) c.prfSecret = null;
  }

  setSignCount(id: Uint8Array, n: number): void {
    const c = this.credential(id);
    if (!c) throw new Error("unknown credential");
    c.signCount = n;
  }

  /** Add a credential with known key material (e.g. an NFC accessory's passkey). */
  importCredential(input: {
    rpId: string;
    privateKey: Uint8Array;
    id?: Uint8Array;
    userHandle?: Uint8Array;
    signCount?: number;
    prfSecret?: Uint8Array | null;
    discoverable?: boolean;
  }): VirtualCredential {
    const cred: VirtualCredential = {
      id: input.id ?? this.derive("cred-id", 16),
      rpId: input.rpId,
      userHandle: input.userHandle ?? this.derive("user", 16),
      privateKey: input.privateKey,
      publicKey: p256.getPublicKey(input.privateKey, false),
      signCount: input.signCount ?? 0,
      prfSecret: input.prfSecret === undefined ? this.derive("prf", 32) : input.prfSecret,
      discoverable: input.discoverable ?? true,
    };
    this.store.set(toBase64Url(cred.id), cred);
    return cred;
  }

  /**
   * Add an NFC accessory whose credential id is its 33-byte compressed P-256
   * public key (the phygital-token convention), and present it to the reader.
   */
  importAccessory(privateKey: Uint8Array): VirtualCredential {
    const cred = this.importCredential({
      rpId: "*",
      privateKey,
      id: p256.getPublicKey(privateKey, true),
      prfSecret: null,
      discoverable: false,
    });
    cred.nfcAccessory = true;
    this.presented = cred.id;
    return cred;
  }

  /** Which accessory is on the reader (null = none; get() then finds only platform passkeys). */
  presentAccessory(id: Uint8Array | null): this {
    this.presented = id;
    return this;
  }

  /** The exact credential object the last get() returned, for replay attacks. */
  lastAssertion(): VaCredential<VaAssertionResponse> {
    if (!this.last) throw new Error("no assertion yet");
    return this.last;
  }

  /** The PRF output a credential yields for `input` (what the relying party would get). */
  prfOutput(id: Uint8Array, input: Uint8Array): Uint8Array {
    const c = this.credential(id);
    if (!c?.prfSecret) throw new Error("credential has no PRF");
    return hmac(sha256, c.prfSecret, prfSaltFor(input));
  }

  // ---------------------------------------------------------------------------
  // navigator.credentials.create
  // ---------------------------------------------------------------------------

  async create(
    options: VaCreateOptions,
    ctx: CeremonyContext,
  ): Promise<VaCredential<VaAttestationResponse>> {
    this.calls.create++;
    const pk = options.publicKey;
    if (!pk) throw domError("NotSupportedError");
    if (options.signal?.aborted) throw domError("AbortError");
    this.throwFault("create");

    const rpId = pk.rp.id ?? hostnameOf(ctx.origin);
    if (!rpIdAllowed(ctx.origin, rpId)) throw domError("SecurityError");
    if (!pk.pubKeyCredParams.some((p) => p.alg === -7)) {
      throw domError("NotSupportedError");
    }
    const sel = pk.authenticatorSelection;
    if (sel?.userVerification === "required" && !this.opts.userVerification) {
      throw domError("NotAllowedError");
    }
    for (const ex of pk.excludeCredentials ?? []) {
      const id = toBytes(ex.id);
      const hit = id && this.credential(id);
      if (hit && hit.rpId === rpId) throw domError("InvalidStateError");
    }

    const challenge = toBytes(pk.challenge);
    if (!challenge) throw new TypeError("challenge required");
    const privateKey = this.newPrivateKey();
    const cred = this.importCredential({
      rpId,
      privateKey,
      userHandle: toBytes(pk.user.id) ?? this.derive("user", 16),
      prfSecret: this.opts.prf ? this.derive("prf", 32) : null,
      discoverable:
        sel?.residentKey === "required" ||
        sel?.residentKey === "preferred" ||
        sel?.requireResidentKey === true,
    });

    const tamper = this.tampers.shift() ?? {};
    const clientDataJSON = this.clientData("webauthn.create", challenge, ctx, tamper);
    const cose = cborEncode(
      new Map<CborValue, CborValue>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, cred.publicKey.slice(1, 33)],
        [-3, cred.publicKey.slice(33, 65)],
      ]),
    );
    const attested = concatBytes(
      AAGUID,
      Uint8Array.of(cred.id.length >> 8, cred.id.length & 0xff),
      cred.id,
      cose,
    );
    const authData = concatBytes(
      this.authDataHead(tamper.rpId ?? rpId, FLAG_AT, cred.signCount, tamper),
      attested,
    );
    const attestationObject = cborEncode(
      new Map<CborValue, CborValue>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );

    const ext: Record<string, unknown> = {};
    const prfIn = (pk.extensions as { prf?: { eval?: { first?: Bytesish } } } | undefined)?.prf;
    if (prfIn) {
      ext["prf"] = { enabled: cred.prfSecret !== null };
      const first = toBytes(prfIn.eval?.first);
      if (first && cred.prfSecret && this.opts.prfAtCreate) {
        (ext["prf"] as Record<string, unknown>)["results"] = {
          first: toArrayBuffer(this.prfOutput(cred.id, first)),
        };
      }
    }

    const spki = concatBytes(
      Uint8Array.from([
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
        0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
      ]),
      cred.publicKey,
    );
    const response: VaAttestationResponse = {
      clientDataJSON: toArrayBuffer(clientDataJSON),
      attestationObject: toArrayBuffer(attestationObject),
      getTransports: () => ["internal", "hybrid"],
      getAuthenticatorData: () => toArrayBuffer(authData),
      getPublicKey: () => toArrayBuffer(spki),
      getPublicKeyAlgorithm: () => -7,
    };
    return this.credentialObject(cred.id, response, ext);
  }

  // ---------------------------------------------------------------------------
  // navigator.credentials.get
  // ---------------------------------------------------------------------------

  async get(
    options: VaGetOptions,
    ctx: CeremonyContext,
  ): Promise<VaCredential<VaAssertionResponse>> {
    this.calls.get++;
    const pk = options.publicKey;
    if (!pk) throw domError("NotSupportedError");
    if (options.signal?.aborted) throw domError("AbortError");
    this.throwFault("get");

    const rpId = pk.rpId ?? hostnameOf(ctx.origin);
    if (!rpIdAllowed(ctx.origin, rpId)) throw domError("SecurityError");
    if (pk.userVerification === "required" && !this.opts.userVerification) {
      throw domError("NotAllowedError");
    }

    const cred = this.pick(rpId, pk.allowCredentials ?? []);
    // A real browser shows "no passkeys available" and the user can only
    // cancel, which surfaces as NotAllowedError.
    if (!cred) throw domError("NotAllowedError", "no matching credential");

    const challenge = toBytes(pk.challenge);
    if (!challenge) throw new TypeError("challenge required");
    if (this.opts.counter === "increment") cred.signCount++;

    const tamper = this.tampers.shift() ?? {};
    const clientDataJSON = this.clientData("webauthn.get", challenge, ctx, tamper);
    const authData = this.authDataHead(tamper.rpId ?? rpId, 0, cred.signCount, tamper);
    const signed = concatBytes(authData, sha256(clientDataJSON));
    const signature = p256.sign(
      tamper.signature ? concatBytes(signed, Uint8Array.of(1)) : signed,
      cred.privateKey,
      { format: "der" },
    );

    const ext: Record<string, unknown> = {};
    const prfIn = (
      pk.extensions as { prf?: { eval?: { first?: Bytesish; second?: Bytesish } } } | undefined
    )?.prf;
    if (prfIn && cred.prfSecret) {
      const first = toBytes(prfIn.eval?.first);
      const second = toBytes(prfIn.eval?.second);
      const results: Record<string, ArrayBuffer> = {};
      if (first) results["first"] = toArrayBuffer(this.prfOutput(cred.id, first));
      if (second) results["second"] = toArrayBuffer(this.prfOutput(cred.id, second));
      ext["prf"] = { results };
    }

    const response: VaAssertionResponse = {
      clientDataJSON: toArrayBuffer(clientDataJSON),
      authenticatorData: toArrayBuffer(authData),
      signature: toArrayBuffer(signature),
      userHandle: cred.discoverable ? toArrayBuffer(cred.userHandle) : null,
    };
    const out = this.credentialObject(cred.id, response, ext);
    this.last = out;
    return out;
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private throwFault(op: CeremonyKind): void {
    const i = this.faults.findIndex((f) => f.op === op || f.op === "any");
    if (i < 0) return;
    const [f] = this.faults.splice(i, 1);
    throw domError(f!.fault);
  }

  private pick(
    rpId: string,
    allow: readonly VaCredentialDescriptor[],
  ): VirtualCredential | undefined {
    if (this.presented) {
      const chip = this.credential(this.presented);
      if (chip?.nfcAccessory) return chip;
    }
    if (allow.length > 0) {
      for (const d of allow) {
        const id = toBytes(d.id);
        const c = id && this.credential(id);
        if (c && c.rpId === rpId) return c;
      }
      return undefined;
    }
    const candidates = this.list().filter((c) => c.rpId === rpId && c.discoverable);
    if (this.preferred) {
      const want = this.preferred;
      this.preferred = null;
      return candidates.find((c) => bytesEqual(c.id, want));
    }
    return candidates[candidates.length - 1];
  }

  private clientData(
    type: string,
    challenge: Uint8Array,
    ctx: CeremonyContext,
    tamper: Tamper,
  ): Uint8Array {
    const crossOrigin = ctx.topOrigin !== undefined && ctx.topOrigin !== ctx.origin;
    return utf8(
      JSON.stringify({
        type: tamper.type ?? type,
        challenge: toBase64Url(tamper.challenge ?? challenge),
        origin: tamper.origin ?? ctx.origin,
        crossOrigin,
        // Chromium's shape for a ceremony in a cross-origin frame.
        ...(crossOrigin ? { topOrigin: ctx.topOrigin } : {}),
      }),
    );
  }

  private authDataHead(
    rpId: string,
    extraFlags: number,
    signCount: number,
    tamper: Tamper,
  ): Uint8Array {
    let flags = FLAG_UP | FLAG_BE | FLAG_BS | extraFlags;
    if (this.opts.userVerification) flags |= FLAG_UV;
    if (tamper.uv === false) flags &= ~FLAG_UV;
    if (tamper.up === false) flags &= ~FLAG_UP;
    return concatBytes(sha256(utf8(rpId)), Uint8Array.of(flags), u32be(signCount));
  }

  private credentialObject<R>(
    id: Uint8Array,
    response: R,
    ext: Record<string, unknown>,
  ): VaCredential<R> {
    return {
      id: toBase64Url(id),
      rawId: toArrayBuffer(id),
      type: "public-key",
      authenticatorAttachment: "platform",
      response,
      getClientExtensionResults: () => ext,
    };
  }

  private derive(label: string, len: number): Uint8Array {
    const out = hmac(sha256, this.seed, utf8(`${label}:${this.nonce++}`));
    return out.slice(0, len);
  }

  private newPrivateKey(): Uint8Array {
    for (;;) {
      const k = this.derive("p256", 32);
      if (p256.utils.isValidSecretKey(k)) return k;
    }
  }
}

/**
 * A `navigator`-shaped object whose `credentials` run on this authenticator in
 * the given origin. Install with `vi.stubGlobal("navigator", navigatorFor(...))`.
 */
export function navigatorFor(
  va: VirtualAuthenticator,
  origin: string,
): { credentials: VirtualCredentialsContainer } {
  return {
    credentials: {
      create: (o?: VaCreateOptions) => va.create(o ?? {}, { origin }),
      get: (o?: VaGetOptions) => va.get(o ?? {}, { origin }),
      preventSilentAccess: async () => {},
      store: async () => {
        throw domError("NotSupportedError");
      },
    },
  };
}

export interface VirtualCredentialsContainer {
  create(o?: VaCreateOptions): Promise<VaCredential<VaAttestationResponse>>;
  get(o?: VaGetOptions): Promise<VaCredential<VaAssertionResponse>>;
  preventSilentAccess(): Promise<void>;
  store(): Promise<never>;
}
