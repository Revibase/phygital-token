<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { onDestroy } from 'svelte';
	import { copyText } from '$lib/client/clipboard';
	import { Button } from '$lib/components/ui/button';

	let { value, label = 'Copy' }: { value: string; label?: string } = $props();
	let copied = $state(false);

	let timer: ReturnType<typeof setTimeout>;
	onDestroy(() => clearTimeout(timer));

	async function copy(e: MouseEvent) {
		e.stopPropagation();
		if (await copyText(value)) {
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		}
	}
</script>

<Button
	variant="ghost"
	size="icon"
	onclick={copy}
	aria-label={copied ? 'Copied' : label}
	class="-mr-2"
>
	{#if copied}<CheckIcon class="animate-rise size-4 text-success" />{:else}<CopyIcon
			class="size-4"
		/>{/if}
</Button>
