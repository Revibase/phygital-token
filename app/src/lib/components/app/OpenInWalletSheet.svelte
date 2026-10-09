<script lang="ts">
	import { KNOWN_WALLETS, type KnownWallet } from '$lib/client/wallet/catalog';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import ResponsiveSheet from './ResponsiveSheet.svelte';
	import List from './List.svelte';
	import ListRow from './ListRow.svelte';

	let {
		browserHref = null,
		onbrowser = () => {},
		hrefFor,
		label,
		onchoose = () => {},
		destination = null,
		open = $bindable(false)
	}: { browserHref?: string | null; onbrowser?: () => void; hrefFor: ((wallet: KnownWallet) => string) | null; label: string; destination?: string | null; onchoose?: (wallet: KnownWallet) => void; open?: boolean } = $props();

	async function copyWebsite() {
		if (!destination) return;
		try {
			await navigator.clipboard.writeText(destination);
			toast.success('Website link copied');
		} catch { toast.error('Couldn’t copy the link'); }
	}
</script>

<ResponsiveSheet bind:open title={label} description="Choose where to open this app.">
	{#if hrefFor}
		<List>
			{#if browserHref}<ListRow label="Open in browser" href={browserHref} target="_blank" reload rel="noopener noreferrer" onclick={onbrowser} external />{/if}
			{#each KNOWN_WALLETS as w (w.id)}
				<ListRow label={`Open in ${w.name}`} href={hrefFor(w)} reload={hrefFor(w).startsWith('/')} onclick={() => onchoose(w)} rel="noopener noreferrer" external>
					{#snippet leading()}<img src={w.icon} alt="" class="size-9 rounded-[9px]" />{/snippet}
				</ListRow>
			{/each}
		</List>
		{#if destination}<Button variant="ghost" class="w-full" onclick={copyWebsite}>Copy website link</Button>{/if}
	{/if}
</ResponsiveSheet>
