import { PhygitalTokenError } from "../errors.js";

/** Base64URL-encoded bytes (unpadded). */
export type Base64URLString = string;

/**
 * A tap in the standard WebAuthn JSON form, safe to `JSON.stringify`. Only
 * `clientExtensionResults.largeBlob.blob` carries the card's signature.
 */
export type AuthenticationResponseJSON = {
  id: Base64URLString;
  rawId: Base64URLString;
  response: {
    clientDataJSON: Base64URLString;
    authenticatorData: Base64URLString;
    signature: Base64URLString;
    userHandle?: Base64URLString;
  };
  authenticatorAttachment?: AuthenticatorAttachment;
  clientExtensionResults: { largeBlob?: { blob?: Base64URLString } };
  type: PublicKeyCredentialType;
};

/**
 * An enrollment in the standard WebAuthn JSON form, safe to `JSON.stringify`.
 * `rawId` is the card's product key (33-byte compressed P-256); verify the
 * packed attestation in `attestationObject` up to the Revi root before trusting it.
 */
export type RegistrationResponseJSON = {
  id: Base64URLString;
  rawId: Base64URLString;
  response: {
    clientDataJSON: Base64URLString;
    attestationObject: Base64URLString;
    transports?: string[];
  };
  authenticatorAttachment?: AuthenticatorAttachment;
  type: PublicKeyCredentialType;
};

export function toBase64URL(bytes: ArrayBuffer | Uint8Array): Base64URLString {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function fromBase64URL(value: Base64URLString): Uint8Array {
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

/**
 * The rpId the SDK sends: the page's hostname, or `""` outside a browser. The
 * card ignores it; only the large-blob signature matters.
 */
export function browserRpId(): string {
  return typeof window !== "undefined" ? (window.location?.hostname ?? "") : "";
}

/** The SDK's own open prompt, closed when the next one starts. */
let openPrompt: AbortController | undefined;

const CANCELLED = "Authentication was cancelled or timed out. Tap the tag again.";

/**
 * Runs one tap prompt. Starting a prompt closes the SDK's previous one, so a
 * tap never fails with "A request is already pending". Aborting `signal`
 * closes this prompt and rejects with the signal's reason.
 */
async function prompt(
  run: (signal: AbortSignal) => Promise<Credential | null>,
  signal: AbortSignal | undefined,
): Promise<PublicKeyCredential> {
  if (typeof globalThis.PublicKeyCredential !== "function") {
    throw new PhygitalTokenError("WEBAUTHN_UNSUPPORTED", "This browser does not support WebAuthn.");
  }
  signal?.throwIfAborted();
  openPrompt?.abort(new DOMException("A newer tap replaced this one.", "AbortError"));
  const controller = new AbortController();
  openPrompt = controller;
  const forward = () => controller.abort(signal!.reason);
  signal?.addEventListener("abort", forward, { once: true });
  try {
    const credential = await run(controller.signal);
    if (!credential) throw new PhygitalTokenError("AUTHENTICATION_CANCELLED", CANCELLED);
    return credential as PublicKeyCredential;
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      throw new PhygitalTokenError("AUTHENTICATION_CANCELLED", CANCELLED, { cause: e });
    }
    throw e;
  } finally {
    signal?.removeEventListener("abort", forward);
    if (openPrompt === controller) openPrompt = undefined;
  }
}

/**
 * Prompt one NFC tap asking the card to sign `allowListId` (`authorize || payload`).
 * One tap, no PIN: the card returns its public key and signature in the large blob.
 */
export async function tapCard(
  allowListId: Uint8Array<ArrayBuffer>,
  signal?: AbortSignal,
): Promise<AuthenticationResponseJSON> {
  const credential = await prompt(
    (promptSignal) =>
      navigator.credentials.get({
        publicKey: {
          challenge: allowListId, // Framing only: the card signs the allowList id, not the challenge.
          rpId: browserRpId(),
          userVerification: "discouraged",
          allowCredentials: [{ id: allowListId, type: "public-key", transports: ["nfc"] }],
          extensions: { largeBlob: { read: true } },
        },
        signal: promptSignal,
      }),
    signal,
  );
  const response = credential.response as AuthenticatorAssertionResponse;
  const blob = credential.getClientExtensionResults().largeBlob?.blob;
  return {
    id: credential.id,
    rawId: toBase64URL(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toBase64URL(response.clientDataJSON),
      authenticatorData: toBase64URL(response.authenticatorData),
      signature: toBase64URL(response.signature),
      userHandle: response.userHandle ? toBase64URL(response.userHandle) : undefined,
    },
    clientExtensionResults: blob ? { largeBlob: { blob: toBase64URL(blob) } } : {},
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ?? undefined,
  };
}

/**
 * Prompt one NFC tap enrolling the card's product key over `challenge`. The
 * card generates the key on its first enrollment and returns the same key,
 * freshly attested, on every later one, so a failed registration can just ask
 * again. No PIN and no resident key, so both are `discouraged`: `"required"`
 * makes the browser refuse the card.
 */
export async function enrollCard(
  challenge: Uint8Array<ArrayBuffer>,
  options?: { signal?: AbortSignal },
): Promise<RegistrationResponseJSON> {
  const credential = await prompt(
    (promptSignal) =>
      navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Revibase", id: browserRpId() },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: "Revibase accessory",
            displayName: "Revibase accessory",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: {
            authenticatorAttachment: "cross-platform",
            residentKey: "discouraged",
            userVerification: "discouraged",
          },
          attestation: "direct",
          hints: ["security-key"],
        } as PublicKeyCredentialCreationOptions,
        signal: promptSignal,
      }),
    options?.signal,
  );
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toBase64URL(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toBase64URL(response.clientDataJSON),
      attestationObject: toBase64URL(response.attestationObject),
      transports: response.getTransports?.(),
    },
    authenticatorAttachment:
      (credential.authenticatorAttachment as AuthenticatorAttachment | null) ?? undefined,
  };
}
