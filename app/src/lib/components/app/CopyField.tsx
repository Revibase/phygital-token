import { cn } from '#lib/utils.ts';
import { CopyButton } from './CopyButton';
import { Panel } from './Panel';

export function CopyField({
	value,
	label,
	mono = false,
	className = ''
}: {
	value: string;
	label: string;
	mono?: boolean;
	className?: string;
}) {
	return (
		<Panel className={cn('flex items-center gap-2 py-1', className)}>
			<span
				className={cn(
					'min-w-0 flex-1 text-left text-[13px]',
					mono ? 'py-2 font-mono leading-snug break-all' : 'truncate'
				)}
			>
				{value}
			</span>
			<CopyButton value={value} label={label} />
		</Panel>
	);
}
