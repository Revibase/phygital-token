import type { PublicKeyCredentialRequestOptionsJSON } from "../webauthn.js";

type NfcWebAuthnClientFields = {
  origin: string;
  crossOrigin?: boolean;
  topOrigin?: string;
};

export type PublicKeyCredentialRequestOptionsJSONWithNfc =
  PublicKeyCredentialRequestOptionsJSON & NfcWebAuthnClientFields;
