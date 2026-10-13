<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { Button } from '$lib/components/ui/button';
	import type { FriendlyError } from '$lib/client/link/messages';

	/** Pass `error` to show a FriendlyError (nothing renders while it's null), or `title`/`body` directly. */
	let {
		title: titleProp,
		body: bodyProp,
		detail: detailProp,
		error,
		tone = 'error',
		actions,
		onretry,
		retrying = false
	}: {
		title?: string;
		body?: string;
		detail?: string;
		error?: FriendlyError | null;
		tone?: 'error' | 'info';
		actions?: Snippet;
		/** Adds the standard "Try again" action. */
		onretry?: () => void;
		retrying?: boolean;
	} = $props();
	const title = $derived(error ? error.title : titleProp);
	const body = $derived(error ? error.body : bodyProp);
	const detail = $derived(error ? error.detail : detailProp);
	let showDetail = $state(false);
</script>

{#if title}
	<div class="animate-rise space-y-3" role={tone === 'error' ? 'alert' : 'status'}>
		<div
			class={cn(
				'flex gap-3 rounded-[14px] px-4 py-3.5',
				tone === 'error' ? 'bg-destructive/[0.07]' : 'bg-muted'
			)}
		>
			{#if tone === 'error'}
				<CircleAlertIcon class="mt-0.5 size-[18px] shrink-0 text-destructive" />
			{:else}
				<InfoIcon class="mt-0.5 size-[18px] shrink-0 text-muted-foreground" />
			{/if}
			<div class="min-w-0 space-y-0.5">
				<p class="text-[15px] font-medium">{title}</p>
				{#if body}<p class="text-[14px] leading-snug text-muted-foreground">{body}</p>{/if}
				{#if detail}
					<button
						type="button"
						class="-ml-1 mt-1 min-h-11 rounded px-1 text-[13px] text-muted-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
						aria-expanded={showDetail}
						onclick={() => (showDetail = !showDetail)}
					>
						{showDetail ? 'Hide details' : 'Details'}
					</button>
					{#if showDetail}<pre
							class="animate-rise mt-1 overflow-x-auto text-[12px] whitespace-pre-wrap text-muted-foreground">{detail}</pre>{/if}
				{/if}
			</div>
		</div>
		{#if actions || onretry}
			<div class="grid gap-2">
				{@render actions?.()}
				{#if onretry}<Button
						variant="secondary"
						class="w-full"
						disabled={retrying}
						onclick={onretry}>{retrying ? 'Trying again…' : 'Try again'}</Button
					>{/if}
			</div>
		{/if}
	</div>
{/if}
