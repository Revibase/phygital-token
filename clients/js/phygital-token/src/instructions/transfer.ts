import {
  type Address,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type TransactionSigner,
} from "@solana/kit";
import {
  bufferToBase64URLString,
  authenticateWithWebauthn,
  nfcWebAuthnRequestOptions,
  type AuthenticationResponseJSON,
} from "../utils/passkey/webauthn.js";
import {
  buildSecp256r1VerifyInstructionFromWebAuthnResponse,
  buildTransferChallenge,
  type Secp256r1VerifyEntry,
} from "../utils/passkey/secp256r1.js";
import { getLatestSlotHash } from "../utils/slotHash.js";
import { getTransferOwnershipInstruction } from "../generated/index.js";
import { parseSecp256r1Pubkey } from "../utils/parseSecp256r1Pubkey.js";

export type TransferSession = {
  rpc: Rpc<SolanaRpcApi>;
  token: Address;
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
 * @param input.rpc - Kit `Rpc`. Convert a web3.js Connection with `toRpc`.
 * @param input.token - Kit `Address` (token PDA). Convert a PublicKey with `toAddress`.
 * @param input.rpId - Relying party ID. Defaults to `window.location.hostname`.
 */
export async function beginTransfer(input: {
  rpc: Rpc<SolanaRpcApi>;
  token: Address;
  rpId?: string;
}): Promise<TransferSession> {
  const { slotHash, slotNumber } = await getLatestSlotHash(input.rpc);
  const challenge = await buildTransferChallenge({
    token: input.token,
    slotHash,
  });

  return {
    rpc: input.rpc,
    token: input.token,
    slotHash,
    slotNumber,
    challenge,
    rpId: input.rpId ?? window.location.hostname,
  };
}

/** Prompts the physical token passkey (WebAuthn / NFC tap). */
export async function authenticatePasskeyForTransfer(
  session: TransferSession,
): Promise<AuthenticationResponseJSON> {
  return authenticateWithWebauthn(
    nfcWebAuthnRequestOptions(bufferToBase64URLString(session.challenge), session.rpId),
  );
}

/**
 * Builds the two on-chain instructions after token authentication.
 * Ownership is updated on the token PDA only — no SPL token transfer.
 *
 * @param recipient - Kit `TransactionSigner`. Convert a web3.js Keypair with `toTransactionSigner`.
 */
export async function completeTransfer(
  session: TransferSession,
  response: AuthenticationResponseJSON,
  recipient: TransactionSigner,
  existingSecp256r1VerifyInputs?: Secp256r1VerifyEntry[],
): Promise<Instruction[]> {
  const { secp256r1VerifyInstruction, signedMessageIndex, clientDataJson } =
    await buildSecp256r1VerifyInstructionFromWebAuthnResponse({
      response,
      secp256r1PublicKey: parseSecp256r1Pubkey(response.id),
      existingSecp256r1VerifyInputs,
    });

  const transferOwnership = getTransferOwnershipInstruction({
    recipient,
    token: session.token,
    slotNumber: session.slotNumber,
    secp256r1VerifyArgs: {
      verifyArgsRelativeIndex: -1,
      signedMessageIndex,
      clientDataJson,
    },
  });

  return [secp256r1VerifyInstruction, transferOwnership];
}
