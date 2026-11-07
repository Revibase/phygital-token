/** Whether this browser exposes WebAuthn, which reading the accessory needs. */
export function webauthnAvailable(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		typeof window.PublicKeyCredential === 'function' &&
		typeof navigator.credentials?.get === 'function'
	);
}

export const TAP_HINT = 'Hold your accessory to your phone’s NFC reader.';

/** "Tap {action}, then hold your accessory …". */
export function tapPrompt(action: string): string {
	return `Tap ${action}, then hold your accessory to your phone’s NFC reader.`;
}
