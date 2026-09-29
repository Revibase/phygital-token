<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import WalletPicker from './WalletPicker.svelte';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import { toast } from 'svelte-sonner';

	/** After the approval tap: pick a wallet here, or reopen the one-time link in a wallet app. */
	let {
		handoffUrl,
		options,
		connecting = null,
		onpick,
		oncomputer
	}: {
		handoffUrl: string;
		options: WalletOption[];
		connecting?: string | null;
		onpick: (id: string) => void;
		oncomputer: () => void;
	} = $props();

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(handoffUrl);
			toast.success('Link copied', { description: 'Paste it into your wallet app’s browser. It works once.' });
		} catch {
			toast.error('Couldn’t copy the link');
		}
	}
</script>

<div class="space-y-4">
	<WalletPicker {options} {connecting} {onpick} browseTarget={handoffUrl} />
	<div class="flex items-center justify-center gap-1 text-[14px]">
		<Button variant="ghost" class="h-11 px-3 text-muted-foreground hover:text-foreground" onclick={copyLink}>Copy link</Button>
		<span class="text-border" aria-hidden="true">|</span>
		<Button variant="ghost" class="h-11 px-3 text-muted-foreground hover:text-foreground" onclick={oncomputer}>Use a computer</Button>
	</div>
</div>
