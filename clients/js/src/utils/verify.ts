import {
  Endian,
  getBase64Decoder,
  getBase64Encoder,
  getU32Encoder,
  type Address,
  type Base64EncodedBytes,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  base64URLStringToBuffer,
  convertSignatureDERtoRS,
  getSecp256r1Message,
  normalizeSignatureToLowS,
  parseWebAuthnClientData,
} from "./passkey/internal.js";
import { p256 } from "@noble/curves/nist.js";
import {
  startAuthentication,
  bufferToBase64URLString,
  type AuthenticationResponseJSON,
  type Base64URLString,
} from "@simplewebauthn/browser";
import {
  getAssetDecoder,
  getVerifyAssetInstruction,
  PHYGITAL_TOKEN_PROGRAM_ADDRESS,
} from "../generated/index.js";
import { authenticateWithNfc } from "./passkey/nfc/index.js";
import { sendInstructions } from "./sendInstructions.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildVerifyMessage,
} from "./passkey/secp256r1.js";
import { getLatestSlotHash } from "./slotHash.js";
import { findAssetPda } from "./pdas/index.js";
import { parseSecp256r1Pubkey } from "../instructions/mint.js";

const DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT = `https://revibase.com/api/verifyDynamicUrl`;

export type VerifyWithChallengeResponseResult = {
  publicKey: string;
  isVerified: boolean;
  signature?: Signature;
};

export type VerifyWithChallengeResponseOptions =
  | {
      rpc?: Rpc<SolanaRpcApi>;
      fetchPublicKeyFromCredentialIdCallback?: GetPublicKeyFromCredentialIdCallback;
      postVerificationOnChain: false;
    }
  | {
      rpc: Rpc<SolanaRpcApi>;
      fetchPublicKeyFromCredentialIdCallback?: GetPublicKeyFromCredentialIdCallback;
      postVerificationOnChain: true;
      message?: string;
      feePayer: TransactionSigner;
    };

export type VerifyDynamicUrlResult = VerifyWithChallengeResponseResult & {
  counter: number;
};

export type VerifyDynamicUrlCallback = (
  params: URLSearchParams,
) => Promise<VerifyDynamicUrlResult>;

const defaultVerifyDynamicUrlCallback: VerifyDynamicUrlCallback = async (
  params,
) => {
  const url = new URL(DEFAULT_VERIFY_DYNAMIC_URL_ENDPOINT);
  for (const [key, value] of params.entries()) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const error = (await response.json()) as { error: string };
    throw new Error(error.error);
  }
  return (await response.json()) as VerifyDynamicUrlResult;
};

/**
 * Verifies a scanned dynamic URL against the server.
 *
 * By default the params are sent to a fixed endpoint. Pass `callback` to fully
 * override how (and where) verification is performed — e.g. to hit your own
 * backend, add auth headers, or verify against a different service.
 *
 * ## Threat model
 *
 * The signed message (`counter || nonce`) is produced by the **chip**, not by
 * the verifier. The URL is therefore a self-contained **bearer proof**: anyone
 * holding it can present it. The server adds an **anti-replay counter check**
 * (it tracks the last-seen counter per key and rejects stale ones), so the
 * *same* URL cannot be accepted twice.
 *
 * What this does NOT protect against:
 * - **Pre-play / race:** an attacker who intercepts a freshly-signed URL before
 *   the genuine request reaches the server can submit it first. The server sees
 *   a new counter, accepts it, and bumps the stored counter — the genuine
 *   request is then rejected as stale.
 * - **Liveness:** it only proves the key signed *some* message at *some* time,
 *   not that the credential is physically present right now.
 *
 * Use this when you only have a scanned URL and are online. If the credential
 * is physically present and you can run an interactive session, prefer
 * {@link verifyWithChallengeResponse}, which is replay-proof because the
 * verifier chooses a fresh challenge.
 *
 * @see verifyDynamicUrlWithoutCounterCheck for the offline variant (no replay protection at all).
 * @see verifyWithChallengeResponse for the strongest, liveness-proving flow.
 */
export async function verifyDynamicUrl(
  params: URLSearchParams,
  callback: VerifyDynamicUrlCallback = defaultVerifyDynamicUrlCallback,
): Promise<VerifyDynamicUrlResult> {
  return callback(params);
}

/**
 * Verifies a scanned dynamic URL **entirely client-side**, with no server call.
 *
 * Reconstructs the signed message from `counter (4 bytes, big-endian) || nonce
 * (8 bytes)` and checks the secp256r1/P-256 signature against the compressed
 * public key embedded in the URL. The signature is normalized to low-S form to
 * reject malleated signatures before verifying.
 *
 * ## Threat model — WEAKEST option, read before using
 *
 * This proves only that the embedded key signed this exact `counter || nonce`
 * message. It has **no anti-replay protection whatsoever**: there is no server
 * state, so it cannot tell whether the counter has been seen before. A captured
 * URL can be replayed indefinitely and will keep verifying.
 *
 * Like {@link verifyDynamicUrl}, the challenge is chosen by the chip, not the
 * verifier, so this also proves nothing about **liveness**.
 *
 * Use this only when:
 * - you are offline / have no backend, AND
 * - signature validity alone is sufficient, OR you track and reject seen
 *   counters yourself in the caller.
 *
 * For anything trust-sensitive, prefer {@link verifyDynamicUrl} (adds the
 * server counter check) or {@link verifyWithChallengeResponse} (replay-proof).
 *
 * @throws if any required param (`pk`, `s`, `c`, `n`) is missing or malformed
 *   (wrong key/signature/nonce length, or out-of-range counter).
 */
export function verifyDynamicUrlWithoutCounterCheck(
  params: URLSearchParams,
): VerifyDynamicUrlResult {
  const publicKey = params.get("pk");
  const signature = params.get("s");
  const counter = params.get("c");
  const nonce = params.get("n");
  if (!publicKey || !signature || !counter || !nonce)
    throw new Error("Missing query params");

  const compressedPk = base64URLStringToBuffer(publicKey);
  if (compressedPk.length !== 33) {
    throw new Error(
      `pk must be 33-byte compressed P-256 key, got ${compressedPk.length} bytes`,
    );
  }

  const randomBytes = base64URLStringToBuffer(nonce);
  if (randomBytes.length !== 8) {
    throw new Error(`n must be 8 bytes, got ${randomBytes.length} bytes`);
  }

  const rawSig = base64URLStringToBuffer(signature);
  if (rawSig.length !== 64) {
    throw new Error(
      `s must be 64-byte raw ECDSA signature, got ${rawSig.length} bytes`,
    );
  }

  const currentCounter = Number.parseInt(counter, 10);
  if (
    !Number.isInteger(currentCounter) ||
    currentCounter < 0 ||
    currentCounter > 0xffffffff
  ) {
    throw new Error(`counter out of uint32 range: ${currentCounter}`);
  }

  const counterBytes = getU32Encoder({ endian: Endian.Big }).encode(
    currentCounter,
  );

  const message = new Uint8Array(12);
  message.set(counterBytes, 0);
  message.set(randomBytes, 4);

  const normalizedSig = normalizeSignatureToLowS(rawSig);
  const isVerified = p256.verify(normalizedSig, message, compressedPk);

  return {
    isVerified,
    publicKey,
    counter: currentCounter,
  };
}

export type GetPublicKeyFromCredentialIdCallback = (
  credentialId: Base64URLString,
) => Promise<Base64URLString>;

async function fetchAssetCredentialFromCredentialId(
  credentialId: Base64URLString,
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ publicKey: Base64URLString; asset: Address }> {
  const data = await rpc
    .getProgramAccounts(PHYGITAL_TOKEN_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { dataSize: BigInt(179) },
        {
          memcmp: {
            encoding: "base64" as const,
            offset: BigInt(115),
            bytes: getBase64Decoder().decode(
              base64URLStringToBuffer(credentialId),
            ) as Base64EncodedBytes,
          },
        },
      ],
    })
    .send();

  if (!data.length) {
    throw new Error("No account found.");
  }

  const asset = getAssetDecoder().decode(
    getBase64Encoder().encode(data[0].account.data[0]),
  );
  return {
    publicKey: bufferToBase64URLString(
      new Uint8Array(asset.publicKey[0]).buffer,
    ),
    asset: data[0].pubkey,
  };
}

async function fetchPublicKeyFromCredentialId(
  credentialId: Base64URLString,
  rpc?: Rpc<SolanaRpcApi>,
): Promise<Base64URLString | null> {
  if (!rpc) return null;
  const resolved = await fetchAssetCredentialFromCredentialId(
    credentialId,
    rpc,
  );
  return resolved.publicKey;
}

/**
 * Transport-agnostic verification core for a WebAuthn authentication response.
 *
 * Confirms the response answers the challenge we issued, then verifies the
 * secp256r1 signature over `authenticatorData || sha256(clientDataJSON)` against
 * the credential's public key. Shared by the browser
 * ({@link verifyWithChallengeResponse}) and native NFC
 * ({@link verifyWithChallengeResponseOverNfc}) flows — both obtain an
 * `AuthenticationResponseJSON`, they just differ in how the ceremony is driven.
 *
 * `expectedChallenge` must be the base64url-encoded random challenge the caller
 * generated for *this* attempt. Verifying it here is what makes the flow
 * replay-proof; callers must never reuse a challenge.
 *
 * @throws "Invalid Signature." if the challenge does not match or the signature
 *   fails; "Rpc is missing." if the public key cannot be resolved.
 */
async function verifyAuthenticationResponse({
  response,
  expectedChallenge,
  rpc,
  fetchPublicKeyFromCredentialIdCallback,
}: {
  response: AuthenticationResponseJSON;
  expectedChallenge: Base64URLString;
  rpc?: Rpc<SolanaRpcApi>;
  fetchPublicKeyFromCredentialIdCallback?: GetPublicKeyFromCredentialIdCallback;
}): Promise<VerifyWithChallengeResponseResult> {
  const clientData = parseWebAuthnClientData(response.response.clientDataJSON);

  if (clientData.challenge !== expectedChallenge) {
    throw new Error("Invalid Signature.");
  }

  const signature = convertSignatureDERtoRS(
    base64URLStringToBuffer(response.response.signature),
  );
  const message = getSecp256r1Message(response);

  const publicKey = await (fetchPublicKeyFromCredentialIdCallback?.(
    response.id,
  ) ?? fetchPublicKeyFromCredentialId(response.id, rpc));

  if (!publicKey) {
    throw new Error("Rpc is missing.");
  }

  const isVerified = p256.verify(
    signature,
    message,
    base64URLStringToBuffer(publicKey),
  );

  if (!isVerified) {
    throw new Error("Invalid Signature.");
  }

  return {
    isVerified,
    publicKey,
  };
}

/**
 * Verifies the credential with a fresh, interactive WebAuthn challenge-response
 * **in the browser**.
 *
 * The **verifier** generates a random 32-byte challenge, runs a WebAuthn
 * authentication ceremony (`startAuthentication`, NFC transport), and checks
 * that the returned signature is valid for that challenge. The public key is
 * resolved from `fetchPublicKeyFromCredentialIdCallback` if provided, otherwise
 * read from the on-chain asset account via `rpc`.
 *
 * ## Threat model — STRONGEST option
 *
 * Because the challenge is chosen by the verifier at verification time (and the
 * returned `clientData.challenge` is compared against it before verifying), this
 * is inherently **replay-proof** and proves **liveness**: it shows the
 * credential is physically present and responding to *this* request *right now*.
 * A recorded response cannot be reused — it was bound to a one-time challenge.
 *
 * This is unlike the dynamic-URL flows, where the chip chooses the signed
 * message and the proof is a reusable bearer token. Prefer this whenever the
 * credential is present and you can run an interactive session.
 *
 * Trade-off: requires a live, interactive WebAuthn/NFC round-trip — it cannot
 * verify an asynchronously-scanned URL. For that case use {@link verifyDynamicUrl}.
 *
 * For native apps (React Native / no `window` or WebAuthn API) use
 * {@link verifyWithChallengeResponseOverNfc}, which drives the same ceremony
 * over a caller-supplied IsoDep transport.
 *
 * @param rpc - Solana RPC used to look up the public key on-chain when no
 *   callback is supplied. Required when `postVerificationOnChain` is true.
 * @param fetchPublicKeyFromCredentialIdCallback - optional override for
 *   resolving the public key from the credential id (e.g. from your own index).
 * @param message - optional message to bind into the on-chain `verify_asset`
 *   instruction. Required when `postVerificationOnChain` is true.
 * @param postVerificationOnChain - when true, uses a slot-bound challenge and
 *   submits a `verify_asset` transaction after local verification succeeds.
 * @param feePayer - pays for the on-chain verification transaction. Required
 *   when `postVerificationOnChain` is true.
 * @throws "Invalid Signature." if the returned challenge does not match the one
 *   we issued, or if signature verification fails.
 */
export async function verifyWithChallengeResponse(
  input: VerifyWithChallengeResponseOptions,
): Promise<VerifyWithChallengeResponseResult> {
  const { fetchPublicKeyFromCredentialIdCallback, postVerificationOnChain } =
    input;
  let expectedChallenge: Uint8Array | null = null;
  let slotNumber: bigint | null = null;
  let message: string | undefined = undefined;
  if (postVerificationOnChain) {
    message = input.message ?? crypto.randomUUID();
    const { slotHash, slotNumber: generatedSlotNumber } =
      await getLatestSlotHash(input.rpc);
    expectedChallenge = await buildVerifyMessage({
      message,
      slotHash,
    });
    slotNumber = generatedSlotNumber;
  } else {
    expectedChallenge = crypto.getRandomValues(new Uint8Array(32));
  }

  const response = await startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64URLString(
        expectedChallenge.buffer as ArrayBuffer,
      ),
      rpId: window.location.hostname,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: "",
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
  });

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: bufferToBase64URLString(
      expectedChallenge.buffer as ArrayBuffer,
    ),
    rpc: input.rpc,
    fetchPublicKeyFromCredentialIdCallback,
  });

  if (postVerificationOnChain) {
    if (!slotNumber) {
      throw new Error("slotNumber is missing.");
    }
    if (!message) {
      throw new Error("message is missing.");
    }
    const { secp256r1Verify, clientDataJson } =
      await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
        response,
        publicKey: result.publicKey,
      });
    const verifyAssetInstruction = getVerifyAssetInstruction({
      asset: await findAssetPda(parseSecp256r1Pubkey(result.publicKey)),
      secp256r1VerifyArgs: {
        signedMessageIndex: 0,
        slotNumber,
        clientDataJson,
      },
      message,
    });
    const signature = await sendInstructions({
      rpc: input.rpc,
      feePayer: input.feePayer,
      instructions: [secp256r1Verify, verifyAssetInstruction],
    });
    result.signature = signature;
  }

  return result;
}

/**
 * Native-app variant of {@link verifyWithChallengeResponse}: runs the same fresh
 * challenge-response ceremony, but drives a **direct CTAP2/FIDO2 getAssertion
 * over IsoDep** instead of the browser WebAuthn API.
 *
 * The caller supplies `transceive`, an APDU→APDU callback wired to their own NFC
 * stack (e.g. `react-native-nfc-manager`'s `NfcTech.IsoDep`). This function
 * generates the random challenge, builds the WebAuthn request, runs SELECT +
 * getAssertion via `transceive`, parses the APDU response into an
 * `AuthenticationResponseJSON`, and verifies it with the shared core.
 *
 * ## Threat model
 *
 * Identical to {@link verifyWithChallengeResponse}: the verifier-chosen
 * challenge makes it **replay-proof** and proves **liveness**. The challenge is
 * generated here and checked against the signed `clientData`, so freshness does
 * not depend on the caller.
 *
 * Because there is no browser, the caller must supply `rpId` and `origin`
 * (used to build `clientDataJSON`); the signed message binds to them exactly as
 * a browser ceremony would.
 *
 * @param transceive - sends a command APDU and resolves with the raw response
 *   APDU (including SW1/SW2). The caller owns the NFC session lifecycle.
 * @param rpc - Solana RPC used to look up the public key on-chain when no
 *   callback is supplied. Required when `postVerificationOnChain` is true.
 * @param fetchPublicKeyFromCredentialIdCallback - optional override for
 *   resolving the public key from the credential id.
 * @param message - optional message to bind into the on-chain `verify_asset`
 *   instruction. Required when `postVerificationOnChain` is true.
 * @param postVerificationOnChain - when true, uses a slot-bound challenge and
 *   submits a `verify_asset` transaction after local verification succeeds.
 * @param feePayer - pays for the on-chain verification transaction. Required
 *   when `postVerificationOnChain` is true.
 * @throws "Invalid Signature." if the challenge does not match or the signature
 *   fails; `ApduError` on NFC/CTAP transport failures.
 */
export async function verifyWithChallengeResponseOverNfc(
  input: VerifyWithChallengeResponseOptions & {
    transceive: (apdu: Uint8Array) => Promise<Uint8Array>;
  },
): Promise<VerifyWithChallengeResponseResult> {
  const { fetchPublicKeyFromCredentialIdCallback, postVerificationOnChain } =
    input;
  let expectedChallenge: Uint8Array | null = null;
  let slotNumber: bigint | null = null;
  let message: string | undefined = undefined;
  if (postVerificationOnChain) {
    message = input.message ?? crypto.randomUUID();
    const { slotHash, slotNumber: generatedSlotNumber } =
      await getLatestSlotHash(input.rpc);
    expectedChallenge = await buildVerifyMessage({
      message,
      slotHash,
    });
    slotNumber = generatedSlotNumber;
  } else {
    expectedChallenge = crypto.getRandomValues(new Uint8Array(32));
  }

  const response = await authenticateWithNfc(
    {
      challenge: bufferToBase64URLString(
        expectedChallenge.buffer as ArrayBuffer,
      ),
      rpId: "revibase.com",
      userVerification: "preferred",
      origin: "https://revibase.com",
      allowCredentials: [
        {
          id: "",
          type: "public-key",
          transports: ["nfc"],
        },
      ],
    },
    input.transceive,
  );

  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: bufferToBase64URLString(
      expectedChallenge.buffer as ArrayBuffer,
    ),
    rpc: input.rpc,
    fetchPublicKeyFromCredentialIdCallback,
  });
  if (postVerificationOnChain) {
    if (!slotNumber) {
      throw new Error("slotNumber is missing.");
    }
    if (!message) {
      throw new Error("message is missing.");
    }
    const { secp256r1Verify, clientDataJson } =
      await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
        response,
        publicKey: result.publicKey,
      });
    const verifyAssetInstruction = getVerifyAssetInstruction({
      asset: await findAssetPda(parseSecp256r1Pubkey(result.publicKey)),
      secp256r1VerifyArgs: {
        signedMessageIndex: 0,
        slotNumber,
        clientDataJson,
      },
      message,
    });
    const signature = await sendInstructions({
      rpc: input.rpc,
      feePayer: input.feePayer,
      instructions: [secp256r1Verify, verifyAssetInstruction],
    });
    result.signature = signature;
  }

  return result;
}
