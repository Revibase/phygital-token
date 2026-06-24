import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

type NfcWebAuthnClientFields = {
  origin: string;
  crossOrigin?: boolean;
  topOrigin?: string;
};

export type PublicKeyCredentialRequestOptionsJSONWithNfc =
  PublicKeyCredentialRequestOptionsJSON & NfcWebAuthnClientFields;
