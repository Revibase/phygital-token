const OLD_OWNER_KEYS = ['revibase:linked:', 'revibase:link-context:'];

/** Owners used to be remembered per accessory; nothing about them is stored now. */
export function clearStoredOwners() {
	try {
		const old = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
			(name): name is string => !!name && OLD_OWNER_KEYS.some((prefix) => name.startsWith(prefix))
		);
		for (const name of old) localStorage.removeItem(name);
	} catch {
		// Storage can be unavailable (private mode); there is nothing to clear then.
	}
}
