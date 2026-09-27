<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { walletHandoffLinks } from '$lib/client/wallet/handoff';
	import LinkIcon from '@lucide/svelte/icons/link';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';

	let { handoffUrl, oncomputer }: { handoffUrl: string; oncomputer: () => void } = $props();
	const wallets = $derived(walletHandoffLinks(handoffUrl));

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
	{#each wallets as w (w.id)}
		<Button href={w.href} size="lg" class="h-14 w-full justify-between rounded-xl px-5 text-base" rel="noopener">
			Open in {w.name}
			<ExternalLinkIcon />
		</Button>
	{/each}
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
