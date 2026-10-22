'use client';

export function FieldError({ message }: { message: string | null | undefined }) {
	if (!message) return null;
	return (
		<p role="alert" className="text-[13px] text-destructive">
			{message}
		</p>
	);
}
