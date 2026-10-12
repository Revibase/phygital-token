<script lang="ts">
 import { Checkbox as Primitive } from 'bits-ui';
 import Check from '@lucide/svelte/icons/check';
 import Minus from '@lucide/svelte/icons/minus';
 import { cn } from '$lib/utils';
 let { checked = $bindable(false), indeterminate = $bindable(false), class: className, ...rest }: Primitive.RootProps = $props();
</script>
<Primitive.Root bind:checked bind:indeterminate data-slot="checkbox" class={cn('peer group flex size-11 min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50', className)} {...rest}>
 {#snippet children({ checked, indeterminate })}
  <span aria-hidden="true" class="flex size-5 items-center justify-center rounded border border-input bg-background text-primary-foreground group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary group-data-[state=indeterminate]:border-primary group-data-[state=indeterminate]:bg-primary">{#if indeterminate}<Minus class="size-3.5" />{:else if checked}<Check class="size-3.5" />{/if}</span>
 {/snippet}
</Primitive.Root>
