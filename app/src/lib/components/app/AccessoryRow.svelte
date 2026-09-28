<script lang="ts">
	import type { Snippet } from 'svelte';
	import AccessoryMark from './AccessoryMark.svelte';
	import ListRow from './ListRow.svelte';
	import { accessoryMedia } from '$lib/client/media';
	import type { AccessoryView } from '$lib/shared/types';

	/** An accessory in a List: its artwork (or our tile), and its collectible name when it has one. */
	let { accessory, trailing }: { accessory: AccessoryView; trailing?: Snippet } = $props();

	let name = $state<string | null>(null);
	$effect(() => {
		name = null;
		if (accessory.mint) void accessoryMedia(accessory.pda).then((m) => (name = m.name));
	});

	const kind = $derived(
		accessory.kind === 'permanent' ? 'Permanently linked' : accessory.kind === 'controlled' ? 'Locked to this wallet' : 'Linked'
	);
</script>

<ListRow label={name ?? `Accessory · ${accessory.tag}`} detail={name ? `${kind} · ${accessory.tag}` : kind} {trailing}>
	{#snippet leading()}<AccessoryMark size="sm" pda={accessory.pda} hasMint={!!accessory.mint} />{/snippet}
</ListRow>
