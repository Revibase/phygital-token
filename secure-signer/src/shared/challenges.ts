/**
 * Domain prefixes for ed25519 prove-possession challenges. The signed message
 * is `utf8(prefix) || challengeBytes` (challenge bytes are base64url on the wire).
 * Wire strings must never be renamed: existing clients sign them.
 */

/** Passkey-wallet backup PUT (secure-signer → app worker). */
export const PUT_CHALLENGE_PREFIX = "revibase.secure-signer.put.v1" as const;

/** The exact bytes a challenge signer signs. */
export function challengeMessage(prefix: string, challengeBytes: Uint8Array): Uint8Array {
  const p = new TextEncoder().encode(prefix);
  const out = new Uint8Array(p.length + challengeBytes.length);
  out.set(p, 0);
  out.set(challengeBytes, p.length);
  return out;
}
