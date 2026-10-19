import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import { authenticatePasskey } from "../utils/passkey/authenticate.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import { fetchMaybePhygitalToken, getSetOwnerInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../utils/parseSecp256r1Pubkey.js";
import { PhygitalTokenError } from "../utils/errors.js";
import { findPhygitalTokenPda } from "../utils/pdas/token.js";

/** State from `beginTransfer` needed to collect the tap and build `set_owner`. */
export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  /** Phygital token PDA derived from {@link TransferSession.secp256r1Pubkey}. */
  phygitalToken: Address;
  /** Base64url compressed secp256r1 passkey public key for the physical token. */
  secp256r1Pubkey: string;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
  rpId: string;
  /** Wallet named by the tap. {@link completeTransfer} must use this signer. */
  recipient: Address;
  /**
   * The token's owner when the session began, or `null` if it had none.
   */
  owner: Address | null;
};

/** The default (all-zero) address the program stores for "no owner". */
const NO_OWNER = "11111111111111111111111111111111" as Address;

/**
 * Prepares a transfer session with slot-bound challenge data.
 * The tap names `recipient`, who must sign the transaction.
 * Must be followed promptly by {@link authenticatePasskeyForTransfer} and
 * {@link completeTransfer}.
 *
 * @param input.rpc - Kit `Rpc`, used to read the latest slot hash.
 * @param input.secp256r1Pubkey - Base64url compressed secp256r1 public key for the
 *   physical token (same shape as a phygital `response.id` / compressed passkey). The phygital
 *   token PDA is derived via {@link findPhygitalTokenPda}.
 * @param input.recipient - Wallet that will become the owner. It is part of the signed challenge.
 * @param input.rpId - Relying party ID for the NFC tap. Defaults to `window.location.hostname`.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  secp256r1Pubkey: string;
  recipient: Address;
  rpId?: string;
}): Promise<TransferSession> {
  const rpId = resolveTransferRpId(input.rpId);
  const phygitalToken = await findPhygitalTokenPda(input.secp256r1Pubkey);
  const [{ slotHash, slotNumber }, token] = await Promise.all([
    getLatestSlotHash(input.rpc),
    fetchMaybePhygitalToken(input.rpc, phygitalToken),
  ]);
  const owner = token.exists && token.data.owner !== NO_OWNER ? token.data.owner : null;
  const challenge = await buildTransferChallenge({
    phygitalToken,
    recipient: input.recipient,
    slotHash,
  });

  return {
    rpc: input.rpc,
    secp256r1Pubkey: input.secp256r1Pubkey,
    phygitalToken,
    slotHash,
    slotNumber,
    challenge,
    rpId,
    recipient: input.recipient,
    owner,
  };
}

function resolveTransferRpId(rpId: string | undefined): string {
  if (rpId) return rpId;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  throw new PhygitalTokenError(
    "RP_ID_REQUIRED",
    "Pass `rpId`; it cannot be inferred outside a browser.",
  );
}

/**
 * Prompts the physical token passkey (WebAuthn / NFC tap).
 *
 * Browser: passes {@link TransferSession.secp256r1Pubkey} in `allowCredentials`.
 * If the platform echoes a random placeholder id, recovery disambiguates by checking
 * which candidate matches {@link TransferSession.secp256r1Pubkey}.
 *
 * Throws `PASSKEY_NOT_RECOGNIZED` if a different tag is tapped.
 */
export async function authenticatePasskeyForTransfer(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey(bufferToBase64URLString(session.challenge), {
    allowList: new Set([session.secp256r1Pubkey]),
    rpId: session.rpId,
    credentialId: session.secp256r1Pubkey,
  });
}

/**
 * Builds the two on-chain instructions after passkey authentication.
 * Owner is updated on the phygital token PDA only — no SPL token transfer.
 *
 * @param recipient - Kit `TransactionSigner` for the wallet named by the tap.
 */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: TransactionSigner,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  if (recipient.address !== session.recipient) {
    throw new PhygitalTokenError(
      "INVALID_ARGUMENT",
      "The signing wallet must be the recipient named by the tap.",
    );
  }
  const { secp256r1VerifyInstruction, signedMessageIndex, clientDataJson } =
    buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      secp256r1PublicKey: parseSecp256r1Pubkey(response.id),
      existingSecp256r1VerifyInputs,
    });

  const setOwner = getSetOwnerInstruction({
    recipient,
    phygitalToken: session.phygitalToken,
    slotNumber: session.slotNumber,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      clientDataJson,
    },
  });

  return [secp256r1VerifyInstruction, setOwner];
}
