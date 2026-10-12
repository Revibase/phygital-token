<script lang="ts">
 import type { HTMLTextareaAttributes } from 'svelte/elements';
 import { cn, type WithElementRef } from '$lib/utils';
 let {ref=$bindable(null),value=$bindable(''),class:className,...rest}:WithElementRef<HTMLTextareaAttributes>=$props();
</script>
<textarea bind:this={ref} bind:value data-slot="textarea" class={cn('flex min-h-24 w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',className)} {...rest}></textarea>
