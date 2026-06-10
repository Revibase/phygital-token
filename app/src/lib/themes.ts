/**
 * Brand colors align with revibase-auth `app.css` oklch tokens.
 */
export const BRAND_COLORS = {
	ink: '#1C1C1E',
	surface: '#F5F5F3'
} as const;

export const THEME_QUERY_PARAM = 'theme';

export const THEMES = ['light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];
