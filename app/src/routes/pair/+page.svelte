<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Spinner } from '$lib/components/ui/spinner';
	import AccessoryMark from '$lib/components/app/AccessoryMark.svelte';
	import Notice from '$lib/components/app/Notice.svelte';
	import PageHeader from '$lib/components/app/PageHeader.svelte';
	import PageShell from '$lib/components/app/PageShell.svelte';
	import { postJson } from '$lib/client/api';
	import { pollLink } from '$lib/client/link/flow';
	import { describeError, type FriendlyError } from '$lib/client/link/messages';
	import type { LinkStatusView } from '$lib/shared/types';

	let status = $state<LinkStatusView | null>(null);
	let failure = $state<FriendlyError | null>(null);
	const poller = new AbortController();
	onDestroy(() => poller.abort());

	onMount(async () => {
		const p = new URLSearchParams(window.location.hash.slice(1)).get('p');
		history.replaceState(null, '', '/pair');
		if (!p) {
			failure = { title: 'This code is incomplete', body: 'Scan the code on your computer again.', recovery: 'start_over', code: 'bad_request' };
			return;
		}
		try {
			status = await postJson<LinkStatusView>('/api/pair/claim', { p });
		} catch (err) {
			failure = describeError(err);
			return;
		}
		const go = (s: LinkStatusView) => {
			if (s.state !== 'pairing' && s.state !== 'paired' && s.state !== 'cancelled' && s.state !== 'expired') {
				void goto(`/accessory/link?link=${encodeURIComponent(s.id)}`, { replaceState: true });
				return true;
			}
			status = s;
			return s.state === 'cancelled' || s.state === 'expired';
		};
		if (!go(status)) void pollLink(status.id, go, poller.signal);
	});
</script>

<svelte:head>
	<title>Connect to your computer · Revibase</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<PageShell>
	<section class="flex flex-1 flex-col items-center justify-center gap-8 pb-8" aria-live="polite">
		{#if failure}
			<div class="w-full"><Notice title={failure.title} body={failure.body} detail={failure.detail} /></div>
		{:else if status?.state === 'cancelled' || status?.state === 'expired'}
			<div class="w-full"><Notice title="Pairing ended" body="Start again on your computer." /></div>
		{:else if status}
			<AccessoryMark state="waiting" />
			<div class="animate-rise w-full">
				<PageHeader align="center" eyebrow="Connected to your computer" eyebrowTone="success" title="Now tap your accessory" body="Hold it to your phone, just like the first time." />
			</div>
		{:else}
			<Spinner class="size-5 text-muted-foreground" />
		{/if}
	</section>
</PageShell>
