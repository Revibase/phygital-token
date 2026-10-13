<script lang="ts">
	import { Switch as Primitive } from 'bits-ui';
	import { cn } from '$lib/utils';
	let { checked = $bindable(false), class: className, ...rest }: Primitive.RootProps = $props();
</script>

<Primitive.Root
	bind:checked
	data-slot="switch"
	class={cn(
		'peer group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
		className
	)}
	{...rest}
>
	<span
		aria-hidden="true"
		class="flex h-7 w-12 items-center rounded-full bg-input p-1 transition-colors group-data-[state=checked]:bg-primary"
	>
		<Primitive.Thumb
			class="size-5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-5"
		/>
	</span>
</Primitive.Root>
