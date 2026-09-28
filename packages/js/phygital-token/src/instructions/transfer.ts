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
import {
  authenticatePasskey,
  type NfcTransceive,
} from "../utils/passkey/authenticate.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import { getSetLinkedWalletInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../utils/parseSecp256r1Pubkey.js";
import { findPhygitalTokenPda } from "../utils/pdas/token.js";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  /** Phygital token PDA derived from {@link secp256r1Pubkey}. */
  phygitalToken: Address;
  /** Base64url compressed secp256r1 passkey public key for the physical token. */
  secp256r1Pubkey: string;
  slotHash: Uint8Array;
  slotNumber: bigint;
  challenge: Uint8Array;
  rpId: string;
};

/**
 * Prepares a transfer session with slot-bound challenge data.
 * Recipient is chosen at wallet confirmation and must sign the transfer transaction.
 * Must be followed promptly by {@link authenticatePasskeyForTransfer} and
 * {@link completeTransfer}.
 *
 * @param input.rpc - Kit `Rpc`.
 * @param input.secp256r1Pubkey - Base64url compressed secp256r1 public key for the
 *   physical token (same shape as a phygital `response.id` / compressed passkey). The phygital
 *   token PDA is derived via {@link findPhygitalTokenPda}.
 * @param input.rpId - Relying party ID for the NFC tap. Defaults to `window.location.hostname`.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  secp256r1Pubkey: string;
  rpId?: string;
}): Promise<TransferSession> {
  const phygitalToken = await findPhygitalTokenPda(input.secp256r1Pubkey);
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    phygitalToken,
    slotHash,
  });

  return {
    rpc: input.rpc,
    secp256r1Pubkey: input.secp256r1Pubkey,
    phygitalToken,
    slotHash,
    slotNumber,
    challenge,
    rpId: resolveTransferRpId(input.rpId),
  };
}

function resolveTransferRpId(rpId: string | undefined): string {
  if (rpId) return rpId;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }
  throw new Error("beginTransfer: pass `rpId` (no window.location available).");
}

/**
 * Prompts the physical token passkey (WebAuthn / NFC tap).
 *
 * Browser: passes {@link TransferSession.secp256r1Pubkey} in `allowCredentials`.
 * If the platform echoes a random placeholder id, recovery disambiguates by checking
 * which candidate has an initialized PhygitalToken PDA on-chain.
 *
 * Native / kiosk: pass `transceive` to use IsoDep APDUs instead of browser WebAuthn.
 */
export async function authenticatePasskeyForTransfer(
  session: TransferSession,
  options?: {
    transceive?: NfcTransceive;
    /** Required when `transceive` is set (clientDataJSON origin). */
    origin?: string;
  },
): Promise<AuthenticationResponseJSON> {
  return authenticatePasskey(bufferToBase64URLString(session.challenge), {
    rpc: session.rpc,
    rpId: session.rpId,
    credentialId: session.secp256r1Pubkey,
    transceive: options?.transceive,
    origin: options?.origin,
  });
}

/**
 * Builds the two on-chain instructions after passkey authentication.
 * Linked wallet is updated on the phygital token PDA only — no SPL token transfer.
 *
 * @param recipient - Kit `TransactionSigner`.
 */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: TransactionSigner,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { secp256r1VerifyInstruction, signedMessageIndex, clientDataJson } =
    buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      secp256r1PublicKey: parseSecp256r1Pubkey(response.id),
      existingSecp256r1VerifyInputs,
    });

  const setLinkedWallet = getSetLinkedWalletInstruction({
    recipient,
    phygitalToken: session.phygitalToken,
    slotNumber: session.slotNumber,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      clientDataJson,
    },
  });

  return [secp256r1VerifyInstruction, setLinkedWallet];
}
