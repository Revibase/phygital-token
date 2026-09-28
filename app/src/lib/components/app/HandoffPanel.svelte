<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import WalletPicker from './WalletPicker.svelte';
	import type { WalletOption } from '$lib/client/wallet/wallet.svelte';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { toast } from 'svelte-sonner';

	/**
	 * After the approval tap: finish with a wallet detected in this browser, or
	 * reopen the single-use `/continue#h=…` link inside a wallet app.
	 */
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
			toast.success('Link copied — open it in your wallet app’s browser');
		} catch {
			toast.error('Couldn’t copy the link');
		}
	}
</script>

<div class="space-y-3">
	<WalletPicker {options} {connecting} {onpick} browseTarget={handoffUrl} />
	<Button variant="outline" size="lg" class="h-12 w-full rounded-xl" onclick={copyLink}>
		<LinkIcon /> Copy link for another wallet
	</Button>
	<div class="flex items-center gap-3 py-1">
		<Separator class="flex-1" /><span class="text-xs text-muted-foreground">or</span><Separator class="flex-1" />
	</div>
	<Button variant="ghost" size="lg" class="h-12 w-full rounded-xl" onclick={oncomputer}>
		<MonitorIcon /> Use a computer instead
	</Button>
	<p class="text-center text-xs text-muted-foreground">
		This link works once and only for a few minutes. Don’t share it.
	</p>
</div>
