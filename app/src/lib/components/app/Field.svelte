<script lang="ts">
	import type { Snippet } from 'svelte';
	import FieldError from './FieldError.svelte';

	/** A form control with its label, an optional hint, and its error in place of the hint. */
	let {
		label,
		id,
		hint,
		error,
		labelAction,
		children
	}: {
		label?: string;
		id?: string;
		hint?: string;
		error?: string | null;
		labelAction?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="space-y-2">
	{#if label}
		<div class="flex min-h-5 items-center justify-between gap-2">
			<label for={id} class="text-[13px] font-medium text-muted-foreground">{label}</label>
			{@render labelAction?.()}
		</div>
	{/if}
	{@render children()}
	{#if error}<FieldError message={error} />{:else if hint}<p
			class="text-[12px] leading-snug text-muted-foreground"
		>
			{hint}
		</p>{/if}
</div>
