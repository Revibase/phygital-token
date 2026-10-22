'use client';

import { Skeleton } from '#lib/components/ui/skeleton';

/** A loading placeholder shaped like a `ListRow`. */
export function ListRowSkeleton({
	avatar = 'size-9 rounded-full',
	detail = false
}: {
	avatar?: string;
	detail?: boolean;
}) {
	return (
		<li className="flex min-h-14 items-center gap-3 px-4 py-2.5" aria-hidden="true">
			<Skeleton className={avatar} />
			<div className="flex-1 space-y-1.5">
				<Skeleton className="h-3.5 w-32" />
				{detail ? <Skeleton className="h-3 w-20" /> : null}
			</div>
		</li>
	);
}
