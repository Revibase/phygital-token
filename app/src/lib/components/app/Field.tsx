'use client';

import { FieldError } from './FieldError';

/** A form control with its label, an optional hint, and its error in place of the hint. */
export function Field({
	label,
	id,
	hint,
	error,
	labelAction,
	children
}: {
	label?: string;
	id?: string;
	hint?: string;
	error?: string | null;
	labelAction?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-2">
			{label ? (
				<div className="flex min-h-5 items-center justify-between gap-2">
					<label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
						{label}
					</label>
					{labelAction}
				</div>
			) : null}
			{children}
			{error ? (
				<FieldError message={error} />
			) : hint ? (
				<p className="text-[12px] leading-snug text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}
