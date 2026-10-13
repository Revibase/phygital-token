import { PRF_SALT, RP_ID } from "./constants.js";
import { randomBytes } from "./crypto.js";
import { bytesToBase64 } from "./encoding.js";
import type { PrfProvider, PrfResult } from "./wallet-service.js";

export class WebAuthnUnsupported extends Error {}
/** The authenticator or browser returned no PRF output. */
export class PrfUnsupported extends WebAuthnUnsupported {}

export type AuthenticationAssertionJSON = {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  authenticatorAttachment?: AuthenticatorAttachment;
};

export type DiscoverablePrfResult = PrfResult & {
  assertion: AuthenticationAssertionJSON;
};

export function currentRpId(): string {
  return RP_ID;
}

function randomChallenge(): Uint8Array {
  return randomBytes(32);
}

// TS 5.9 Uint8Array<ArrayBufferLike> vs DOM BufferSource.
const buf = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

function getAssertion(
  publicKey: PublicKeyCredentialRequestOptions,
): Promise<PublicKeyCredential | null> {
  return navigator.credentials.get({
    publicKey,
  }) as Promise<PublicKeyCredential | null>;
}

function extractPrf(cred: PublicKeyCredential): Uint8Array {
  const results = (
    cred.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    }
  ).prf;
  const first = results?.results?.first;
  if (!first) {
    throw new PrfUnsupported("PRF not available for this credential");
  }
  return new Uint8Array(first);
}

export function assertionToJSON(cred: PublicKeyCredential): AuthenticationAssertionJSON {
  const response = cred.response as AuthenticatorAssertionResponse;
  const out: AuthenticationAssertionJSON = {
    id: cred.id,
    rawId: bytesToBase64(new Uint8Array(cred.rawId), "url"),
    type: "public-key",
    response: {
      clientDataJSON: bytesToBase64(new Uint8Array(response.clientDataJSON), "url"),
      authenticatorData: bytesToBase64(new Uint8Array(response.authenticatorData), "url"),
      signature: bytesToBase64(new Uint8Array(response.signature), "url"),
    },
    clientExtensionResults: {},
  };
  if (response.userHandle) {
    out.response.userHandle = bytesToBase64(new Uint8Array(response.userHandle), "url");
  }
  if (cred.authenticatorAttachment) {
    out.authenticatorAttachment = cred.authenticatorAttachment as AuthenticatorAttachment;
  }
  return out;
}

export class BrowserPrfProvider implements PrfProvider {
  async create(rpId: string, opts: { userName: string }): Promise<PrfResult> {
    const userId = randomBytes(16);
    const userName = opts.userName;
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: buf(randomChallenge()),
        rp: { id: rpId, name: userName },
        user: {
          id: buf(userId),
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        extensions: {
          prf: { eval: { first: buf(PRF_SALT) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new WebAuthnUnsupported("credential creation returned null");

    const credentialId = new Uint8Array(cred.rawId);
    let prfOutput: Uint8Array;
    try {
      prfOutput = extractPrf(cred);
    } catch {
      prfOutput = await this.get(rpId, credentialId).then((r) => r.prfOutput);
    }
    return { credentialId, prfOutput };
  }

  async get(
    rpId: string,
    credentialId: Uint8Array,
    challenge?: Uint8Array,
  ): Promise<{ prfOutput: Uint8Array }> {
    const assertion = await getAssertion({
      challenge: buf(challenge ?? randomChallenge()),
      rpId,
      allowCredentials: [
        {
          type: "public-key",
          id: buf(credentialId),
          transports: ["internal", "hybrid"],
        },
      ],
      userVerification: "required",
      extensions: {
        prf: { eval: { first: buf(PRF_SALT) } },
      } as AuthenticationExtensionsClientInputs,
    });
    if (!assertion) throw new WebAuthnUnsupported("assertion returned null");
    return { prfOutput: extractPrf(assertion) };
  }

  /** `challenge` must be the server restore-challenge (PRF + D1 auth). */
  async getDiscoverable(rpId: string, challenge: Uint8Array): Promise<DiscoverablePrfResult> {
    const assertion = await getAssertion({
      challenge: buf(challenge),
      rpId,
      userVerification: "required",
      extensions: {
        prf: { eval: { first: buf(PRF_SALT) } },
      } as AuthenticationExtensionsClientInputs,
    });
    if (!assertion) throw new WebAuthnUnsupported("assertion returned null");
    return {
      credentialId: new Uint8Array(assertion.rawId),
      prfOutput: extractPrf(assertion),
      assertion: assertionToJSON(assertion),
    };
  }
}
