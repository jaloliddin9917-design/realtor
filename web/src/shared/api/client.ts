import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { API_BASE } from "@/shared/config";
import { ApiProblem, problemFrom } from "./problem";

interface AuthHooks { getAccess: () => string | null; refresh: () => Promise<string | null> }
let auth: AuthHooks = { getAccess: () => null, refresh: async () => null };

/** Called once by the session entity; shared/ must not import entities/. */
export function configureAuth(hooks: AuthHooks): void {
  auth = hooks;
}

const RETRIED = new WeakSet<Request>();

const bearer: Middleware = {
  async onRequest({ request }) {
    const token = auth.getAccess();
    if (token && !request.headers.has("authorization")) request.headers.set("authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401 || RETRIED.has(request)) return response;
    const body: unknown = await response.clone().json().catch(() => null);
    const code = body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : undefined;
    if (code !== "auth.token_expired") return response;
    const fresh = await auth.refresh();
    if (!fresh) return response;
    const retry = new Request(request, { headers: new Headers(request.headers) });
    retry.headers.set("authorization", `Bearer ${fresh}`);
    RETRIED.add(retry);
    return fetch(retry);
  },
};

/**
 * `API_BASE = ""` means "same origin" (Caddy/Vite proxy `/api` in prod/dev — see
 * shared/config). openapi-fetch builds a `Request` for every call, and the WHATWG
 * `Request` constructor only resolves a root-relative URL against a document base
 * when one runs in an actual browsing context; Node's own `Request` (what jsdom-based
 * tests use, since jsdom itself does not implement Fetch) has no such base and throws
 * on a bare `/api/...` path. `window.location.origin` is available in both a real
 * browser and jsdom, always names the current origin, and yields the exact same
 * absolute URL a plain relative fetch would have hit — so resolving it explicitly here
 * keeps "same origin" working in both environments without changing what `API_BASE`
 * means or hardcoding a host.
 */
const baseUrl = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
export const api = createClient<paths>({
  baseUrl,
  // openapi-fetch reads `clientOptions.fetch` once, at createClient() time, and closes
  // over that value — so without this wrapper it would permanently capture whatever
  // `globalThis.fetch` was when this module first loaded. Indirecting through a
  // function makes every call look up `globalThis.fetch` fresh, which is what lets
  // `vi.stubGlobal("fetch", ...)` (run inside a test, after this module has already
  // been imported) actually take effect; behavior against the real global is unchanged.
  fetch: (request) => globalThis.fetch(request),
});
api.use(bearer);

/**
 * `openapi-fetch` returns a discriminated union `{data, response} | {error, response}`;
 * effects want a value or a thrown ApiProblem. The parameter type here is a deliberately
 * widened (non-discriminated) shape rather than openapi-fetch's own `FetchResponse<...>` —
 * that generic needs the operation's Paths/Media type parameters threaded through, which
 * would leak openapi-fetch internals into every call site; each union member of the real
 * return type is structurally assignable to this shape, so inference of `T` still lands on
 * the success `data` type at each call site.
 */
export async function unwrap<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await result;
  if (error !== undefined || data === undefined) throw problemFrom(response.status, error ?? null);
  return data;
}

export type { paths } from "./schema";
export type { components } from "./schema";
export { ApiProblem };
