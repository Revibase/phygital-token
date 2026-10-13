<script lang="ts">
	import { Select as Primitive } from 'bits-ui';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	let {
		value = $bindable(''),
		options,
		disabled = false,
		label,
		onValueChange
	}: {
		value?: string;
		options: { value: string; label: string }[];
		disabled?: boolean;
		label: string;
		onValueChange?: (value: string) => void;
	} = $props();
</script>

<Primitive.Root type="single" bind:value {disabled} {onValueChange}>
	<Primitive.Trigger
		aria-label={label}
		class="flex h-12 w-full items-center justify-between gap-3 rounded-xl border border-input bg-background px-3 text-[14px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
		><span>{options.find((o) => o.value === value)?.label ?? 'Choose…'}</span><ChevronDown
			class="size-4 text-muted-foreground"
		/></Primitive.Trigger
	>
	<Primitive.Portal
		><Primitive.Content
			class="z-50 max-h-[min(20rem,var(--bits-select-content-available-height))] overflow-y-auto min-w-[var(--bits-select-anchor-width)] rounded-xl border bg-popover p-1 text-popover-foreground shadow-md"
			sideOffset={4}
			><Primitive.Viewport
				>{#each options as option (option.value)}<Primitive.Item
						value={option.value}
						label={option.label}
						class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-sm outline-none data-highlighted:bg-accent"
						>{#snippet children({ selected })}<span>{option.label}</span>{#if selected}<Check
									class="size-4"
								/>{/if}{/snippet}</Primitive.Item
					>{/each}</Primitive.Viewport
			></Primitive.Content
		></Primitive.Portal
	>
</Primitive.Root>
