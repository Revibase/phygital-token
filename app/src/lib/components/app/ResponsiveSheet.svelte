<script lang="ts">
	import type { Snippet } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Drawer from '$lib/components/ui/drawer';
	import { cn } from '$lib/utils';

	/**
	 * One overlay, the right shape for the device:
	 * - ≥768px: a centred dialog (fades/scales in 200ms, out in 150ms).
	 * - smaller: a bottom sheet with a drag handle (native-feeling slide).
	 * Escape, the backdrop, and the content's own Cancel all close it.
	 * The title is always announced; `hideTitle` keeps it visual-only when the
	 * content renders its own heading (e.g. a stepped flow).
	 */
	let {
		open = $bindable(false),
		title,
		description,
		hideTitle = false,
		children
	}: {
		open?: boolean;
		title: string;
		description?: string;
		hideTitle?: boolean;
		children: Snippet;
	} = $props();

	const desktop = new MediaQuery('min-width: 768px', false);
	let dialogEl = $state<HTMLElement | null>(null);

	/** Focus the dialog itself on open (trap stays inside) rather than ringing its first control. */
	function focusDialog(e: Event) {
		e.preventDefault();
		dialogEl?.focus();
	}
</script>

{#snippet header(Title: typeof Dialog.Title | typeof Drawer.Title, Description: typeof Dialog.Description | typeof Drawer.Description)}
	<div class={cn('space-y-1 text-left', hideTitle && 'sr-only')}>
		<Title class="text-[20px] leading-tight font-semibold tracking-[-0.02em]">{title}</Title>
		{#if description}<Description class="text-[14px] leading-snug text-muted-foreground">{description}</Description>{/if}
	</div>
{/snippet}

{#if desktop.current}
	<Dialog.Root bind:open>
		<Dialog.Content
			bind:ref={dialogEl}
			tabindex={-1}
			onOpenAutoFocus={focusDialog}
			showCloseButton={false}
			class="max-h-[min(720px,calc(100dvh-4rem))] gap-0 overflow-y-auto outline-none rounded-[20px] bg-background p-6 shadow-[0_24px_64px_-24px_rgb(14_26_26/0.35)] ring-black/5 sm:max-w-[420px] data-open:duration-200 data-closed:duration-150"
		>
			<div class="space-y-5">
				{@render header(Dialog.Title, Dialog.Description)}
				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Root>
{:else}
	<Drawer.Root bind:open>
		<Drawer.Content class="bg-background">
			<div class="mx-auto w-full max-w-md space-y-5 overflow-y-auto px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
				{@render header(Drawer.Title, Drawer.Description)}
				{@render children()}
			</div>
		</Drawer.Content>
	</Drawer.Root>
{/if}
