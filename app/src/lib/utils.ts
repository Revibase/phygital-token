export { cn } from 'cn';

/* eslint-disable @typescript-eslint/no-explicit-any -- shadcn-svelte helper types match any child/children prop. */
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
/* eslint-enable @typescript-eslint/no-explicit-any */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
