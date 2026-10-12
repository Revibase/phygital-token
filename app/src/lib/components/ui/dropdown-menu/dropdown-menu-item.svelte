<script lang="ts">
 import { DropdownMenu as Primitive } from 'bits-ui';
 import { cn } from '$lib/utils';
 let { ref = $bindable(null), class: className, ...rest }: Primitive.ItemProps = $props();
</script>
<Primitive.Item bind:ref class={cn('relative flex min-h-11 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50',className)} {...rest} />
