import { cn } from '#lib/utils.ts';

export function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
	return (
		<input
			type={type}
			className={cn(
				'flex h-12 w-full min-w-0 rounded-xl border border-input bg-background px-4 text-[16px] outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
				type === 'file' &&
					'cursor-pointer p-1 pr-3 text-[14px] leading-[38px] text-muted-foreground file:mr-3 file:h-[38px] file:cursor-pointer file:rounded-lg file:border-0 file:bg-muted file:px-4 file:text-[14px] file:font-medium file:text-foreground hover:file:bg-muted/80',
				className
			)}
			{...props}
		/>
	);
}
