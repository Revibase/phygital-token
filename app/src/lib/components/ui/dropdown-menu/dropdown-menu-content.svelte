<script lang="ts">
 import { DropdownMenu as Primitive } from 'bits-ui';
 import { cn } from '$lib/utils';
 let { ref = $bindable(null), class: className, sideOffset = 4, ...rest }: Primitive.ContentProps = $props();
</script>
<Primitive.Portal><Primitive.Content bind:ref {sideOffset} class={cn('z-50 min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-md outline-none',className)} {...rest} /></Primitive.Portal>
