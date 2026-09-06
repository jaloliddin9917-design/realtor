/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute base URL of the API for a split deploy, e.g. "https://realtor-api.onrender.com".
   *  Empty/undefined means "same origin" (local dev + the single-host Caddy deploy). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
