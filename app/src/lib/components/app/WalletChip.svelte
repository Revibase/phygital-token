<script lang="ts">
	import * as Avatar from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { shortAddress } from '$lib/shared/encoding';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';

	let { address, label = 'Wallet', icon = null }: { address: string; label?: string; icon?: string | null } = $props();
	let copied = $state(false);

	// Deterministic two-tone "identicon" so the same wallet always looks the same.
	const hue = $derived([...address].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));

	async function copy() {
		try {
			await navigator.clipboard.writeText(address);
			copied = true;
			toast.success('Wallet address copied');
			setTimeout(() => (copied = false), 1600);
		} catch {
			toast.error('Couldn’t copy');
		}
	}
</script>

<div class="flex items-center gap-3 rounded-2xl border bg-card/60 p-3 pr-2">
	<Avatar.Root class="size-10 rounded-xl">
		{#if icon}<Avatar.Image src={icon} alt="" class="rounded-xl" />{/if}
		<Avatar.Fallback
			class="rounded-xl"
			style={`background: linear-gradient(135deg, oklch(0.75 0.12 ${hue}), oklch(0.5 0.12 ${(hue + 70) % 360}))`}
		/>
	</Avatar.Root>
	<div class="min-w-0 flex-1">
		<p class="text-xs text-muted-foreground">{label}</p>
		<p class="font-mono text-sm tracking-tight" title={address}>{shortAddress(address)}</p>
	</div>
	<Button variant="ghost" size="icon" class="size-11" onclick={copy} aria-label="Copy wallet address">
		{#if copied}<CheckIcon />{:else}<CopyIcon />{/if}
	</Button>
</div>
