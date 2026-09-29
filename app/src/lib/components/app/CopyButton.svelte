<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';

	/** Icon button; the icon swaps to a check for 1.5s — the confirmation is in place, not only in a toast. */
	let { value, label = 'Copy' }: { value: string; label?: string } = $props();
	let copied = $state(false);

	async function copy(e: MouseEvent) {
		e.stopPropagation();
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			toast.error('Couldn’t copy. Select the text instead.');
		}
	}
</script>

<button
	type="button"
	onclick={copy}
	aria-label={copied ? 'Copied' : label}
	class="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground active:scale-95 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
>
	{#if copied}<CheckIcon class="animate-rise size-4 text-success" />{:else}<CopyIcon class="size-4" />{/if}
</button>
