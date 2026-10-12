/**
 * The WebAuthn RP ID shared by the app (passkey create), the secure-signer
 * (get + PRF) and the app worker (attestation / assertion verification). All
 * three must derive the same value or passkeys and backups stop verifying.
 *
 * An explicit override wins (`VITE_RP_ID` / `RP_ID`, which must be equal); otherwise: localhost → "localhost",
 * revibase.com and its subdomains → "revibase.com", anything else → hostname.
 */
export function resolveWebAuthnRpId(hostname: string, envRpId?: string): string {
  const fromEnv = envRpId?.trim();
  if (fromEnv) return fromEnv;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "localhost";
  if (hostname === "revibase.com" || hostname.endsWith(".revibase.com")) {
    return "revibase.com";
  }
  return hostname;
}
