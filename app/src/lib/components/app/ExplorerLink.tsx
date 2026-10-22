import { ArrowUpRight } from 'lucide-react';

import { explorerUrl } from '#lib/shared/explorer.ts';

export function ExplorerLink({
	value,
	cluster,
	kind = 'address',
	label
}: {
	value: string;
	cluster: string;
	kind?: 'address' | 'tx';
	label: string;
}) {
	return (
		<a
			href={explorerUrl(kind, value, cluster)}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={label}
			onClick={(event) => event.stopPropagation()}
			className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-95"
		>
			<ArrowUpRight className="size-4" />
		</a>
	);
}
