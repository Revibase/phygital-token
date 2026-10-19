<script lang="ts">
	import { cn } from '#lib/utils.ts';
	import CopyButton from './CopyButton.svelte';
	import Panel from './Panel.svelte';

	/** A value to copy, such as an address or a link, with its copy button. */
	let {
		value,
		label,
		mono = false,
		class: className = ''
	}: { value: string; label: string; mono?: boolean; class?: string } = $props();
</script>

<Panel class={cn('flex items-center gap-2 py-1', className)}>
	<span
		class={cn(
			'min-w-0 flex-1 text-left text-[13px]',
			mono ? 'py-2 font-mono leading-snug break-all' : 'truncate'
		)}>{value}</span
	>
	<CopyButton {value} {label} />
</Panel>
