import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

/** Absolute path to a package's ESM build, bypassing its "exports" map. */
const esmBuild = (pkg: string, file: string) =>
  fileURLToPath(new URL(file, pathToFileURL(createRequire(import.meta.url).resolve(`${pkg}/package.json`))));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    // the API (and /api/v1/photos) is same-origin in production behind Caddy; mirror that in dev
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
  test: {
    // atomic-router's "exports" map answers the "node" condition — which vitest resolves
    // with, and cannot be talked out of, since Vite concatenates condition arrays — with the
    // CJS build, and that build `require`s effector's CJS entry. The result is a *second*
    // effector instance whose kernel knows nothing about the scope `allSettled` runs in, so
    // the router's own effects settle outside the fork and every scoped assertion reads a
    // default. Point the tests at the same ESM builds `vite dev`/`vite build` already pick,
    // so one effector serves the app and the router alike.
    alias: {
      "atomic-router": esmBuild("atomic-router", "./dist/atomic-router.mjs"),
      "atomic-router-react": esmBuild("atomic-router-react", "./dist/index.mjs"),
    },
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // restore globals (notably `fetch`) after every test so a stub cannot leak
    unstubGlobals: true,
  },
});
