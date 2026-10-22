import Link from 'next/link';
import { tv, type VariantProps } from 'tailwind-variants';

import { cn } from '#lib/utils.ts';

export const buttonVariants = tv({
	base: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-xl border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:scale-[0.98] [&_svg:not([class*='size-'])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out active:duration-75 outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	variants: {
		variant: {
			default:
				'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_8%)] active:bg-[color-mix(in_oklch,var(--primary),black_14%)]',
			secondary:
				'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] active:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_9%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
			ghost:
				'hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground',
			destructive:
				'bg-destructive/10 hover:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/20 text-destructive focus-visible:border-destructive/40 dark:hover:bg-destructive/30',
			quiet:
				'text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/50 aria-expanded:bg-muted aria-expanded:text-foreground'
		},
		size: {
			default: 'h-11 gap-1.5 px-2.5',
			sm: 'h-11 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5',
			icon: "size-11 rounded-full text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-5",
			xl: "h-13 w-full gap-2 rounded-[14px] px-5 text-[15px] font-semibold [&_svg:not([class*='size-'])]:size-[18px]"
		}
	},
	defaultVariants: {
		variant: 'default',
		size: 'default'
	}
});

export type ButtonProps = React.ComponentProps<'button'> &
	VariantProps<typeof buttonVariants> & {
		href?: string;
		target?: string;
		rel?: string;
	};

export function Button({
	className,
	variant = 'default',
	size = 'default',
	href,
	target,
	rel,
	type = 'button',
	disabled,
	...props
}: ButtonProps) {
	const classes = cn(buttonVariants({ variant, size }), className);
	if (href) {
		return (
			<Link
				{...(props as Omit<React.ComponentProps<typeof Link>, 'href'>)}
				href={disabled ? '#' : href}
				target={target}
				rel={rel}
				data-slot="button"
				className={classes}
				aria-disabled={disabled || undefined}
				tabIndex={disabled ? -1 : undefined}
			/>
		);
	}
	return (
		<button data-slot="button" className={classes} type={type} disabled={disabled} {...props} />
	);
}
