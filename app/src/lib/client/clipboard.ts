import { toast } from 'svelte-sonner';

/** Returns whether copying succeeded so callers can show local feedback. */
export async function copyText(
	value: string,
	success?: string,
	failure = 'Couldn’t copy. Select the text instead.'
): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value);
		if (success) toast.success(success);
		return true;
	} catch {
		toast.error(failure);
		return false;
	}
}
