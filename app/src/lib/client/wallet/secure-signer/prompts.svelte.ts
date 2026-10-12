import type { LostChoice, SetupChoice } from './connect';

/** App-side sheets the passkey wallet opens during connect; rendered by SecureSignerHost. */
export const passkeyPrompts = $state<{
	setup: ((choice: SetupChoice) => void) | null;
	lost: { reason: 'not_found' | 'failed'; resolve: (choice: LostChoice) => void } | null;
}>({ setup: null, lost: null });

export function promptSetup(): Promise<SetupChoice> {
	return new Promise((resolve) => {
		passkeyPrompts.setup = (choice) => {
			passkeyPrompts.setup = null;
			resolve(choice);
		};
	});
}

export function promptLost(reason: 'not_found' | 'failed'): Promise<LostChoice> {
	return new Promise((resolve) => {
		passkeyPrompts.lost = {
			reason,
			resolve: (choice) => {
				passkeyPrompts.lost = null;
				resolve(choice);
			}
		};
	});
}
