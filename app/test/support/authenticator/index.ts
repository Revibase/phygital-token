// A software WebAuthn authenticator for headless tests.
export {
	VirtualAuthenticator,
	navigatorFor,
	prfSaltFor,
	type CeremonyContext,
	type VaAssertionResponse,
	type VaAttestationResponse,
	type VaCreateOptions,
	type VaCredential,
	type VaCredentialDescriptor,
	type VaGetOptions,
	type VirtualCredentialsContainer,
	type CeremonyKind,
	type Tamper,
	type VirtualAuthenticatorOptions,
	type VirtualCredential,
	type WebAuthnFault
} from './virtual-authenticator.js';
export { cborEncode, type CborValue } from './cbor.js';
