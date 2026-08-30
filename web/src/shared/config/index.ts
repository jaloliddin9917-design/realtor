export const APP_NAME = "Realtor CRM";
/** Same origin: Caddy proxies /api in production, Vite proxies it in dev. */
export const API_BASE = "";
export const LANG_STORAGE_KEY = "lang";
export const TOKEN_STORAGE_KEY = "tokens";
export const SUPPORTED_LANGS = ["uz", "ru"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
