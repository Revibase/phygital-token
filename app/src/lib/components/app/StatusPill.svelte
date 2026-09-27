<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';

	let { tone = 'neutral', label }: { tone?: 'ok' | 'warn' | 'neutral' | 'accent'; label: string } = $props();
	const dot = { ok: 'bg-success', warn: 'bg-destructive', neutral: 'bg-muted-foreground', accent: 'bg-primary' };
</script>

<Badge variant="outline" class="h-7 gap-2 rounded-full px-3 text-[13px] font-medium">
	<span class={cn('size-1.5 rounded-full', dot[tone])}></span>
	{label}
</Badge>
