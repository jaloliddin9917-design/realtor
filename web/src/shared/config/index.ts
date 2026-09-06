export const APP_NAME = "Realtor CRM";
/** Same origin: Caddy proxies /api in production, Vite proxies it in dev. */
// "" = same origin (Vite/Caddy proxy `/api`); a hosted split deploy (SPA on Cloudflare
// Pages, API on Render) sets VITE_API_BASE at build time to the API's absolute URL.
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";
export const LANG_STORAGE_KEY = "lang";
export const TOKEN_STORAGE_KEY = "tokens";
export const SUPPORTED_LANGS = ["uz", "ru"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
