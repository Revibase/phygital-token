'use client';

import { Panel } from './Panel';

export function EmptyState({ title, body }: { title: string; body?: string }) {
	return (
		<Panel className="py-5 text-center">
			<p className="text-[15px] font-medium">{title}</p>
			{body ? <p className="mt-0.5 text-[14px] text-muted-foreground">{body}</p> : null}
		</Panel>
	);
}
