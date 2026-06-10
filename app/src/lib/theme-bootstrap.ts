import { BRAND_COLORS, THEME_QUERY_PARAM } from '$lib/themes';

export function buildThemeBootstrapScript(): string {
	return `(function(){try{var root=document.documentElement;var t=new URLSearchParams(window.location.search).get(${JSON.stringify(THEME_QUERY_PARAM)});if(t==="light"){root.classList.remove("dark");}else if(t==="dark"){root.classList.add("dark");}var isDark=root.classList.contains("dark");var color=isDark?${JSON.stringify(BRAND_COLORS.ink)}:${JSON.stringify(BRAND_COLORS.surface)};var meta=document.querySelector('meta[name="theme-color"]');if(meta){meta.setAttribute("content",color);}}catch(e){}})();`;
}
