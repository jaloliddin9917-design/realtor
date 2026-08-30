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

/**
 * Maps the request openapi-fetch is about to send to an untouched clone of it. Sending a
 * request consumes its body, and `new Request(alreadySent, …)` then throws ("Cannot
 * construct a Request with a Request object that has already been used"), so the 401
 * retry has to be rebuilt from a clone taken *before* the send — never from the sent
 * request itself. `clone()` does not disturb the original, so taking one costs nothing.
 */
const PRISTINE = new WeakMap<Request, Request>();

/** The refresh endpoint is authenticated by the refresh token, not the access token. */
function isAuthEndpoint(url: string): boolean {
  const { pathname } = new URL(url);
  return pathname.endsWith("/auth/refresh") || pathname.endsWith("/auth/login");
}

let inflightRefresh: Promise<string | null> | null = null;

/** Concurrent 401s share one refresh call instead of racing several against the API. */
function refreshOnce(): Promise<string | null> {
  const pending = inflightRefresh ?? auth.refresh().finally(() => { inflightRefresh = null; });
  inflightRefresh = pending;
  return pending;
}

const bearer: Middleware = {
  async onRequest({ request }) {
    const token = auth.getAccess();
    if (token && !request.headers.has("authorization")) request.headers.set("authorization", `Bearer ${token}`);
    // openapi-fetch sends this exact object, so it is the key the response side will see.
    PRISTINE.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401) return response;
    // The refresh call goes through this same middleware, and the API answers an expired
    // *refresh* token with the very same 401 auth.token_expired — refreshing in response
    // to that would recurse until the stack or the API gives out. Login is exempt for the
    // same reason: a bad password must not trigger a token refresh.
    if (isAuthEndpoint(request.url)) return response;
    const body: unknown = await response.clone().json().catch(() => null);
    const code = body && typeof body === "object" && "code" in body ? (body as { code?: unknown }).code : undefined;
    if (code !== "auth.token_expired") return response;
    const fresh = await refreshOnce();
    if (!fresh) return response;
    const pristine = PRISTINE.get(request);
    // Only reachable if another middleware swapped the request object out; replaying the
    // consumed one would throw, so surface the 401 instead.
    if (!pristine) return response;
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${fresh}`);
    // The retry is sent through a bare fetch(), which never re-enters this middleware, so
    // one retry per request is structural — no "already retried" bookkeeping is needed.
    return fetch(new Request(pristine, { headers }));
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
 *
 * A successful response is allowed to carry no body: openapi-fetch reports 204 (and any
 * empty 2xx) as `{ data: undefined, response }`, which is a value, not a failure — only
 * `error` or a non-2xx status makes a problem.
 */
export async function unwrap<T>(result: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await result;
  if (error !== undefined || !response.ok) throw problemFrom(response.status, error ?? null);
  return data as T;
}

export type { paths } from "./schema";
export type { components } from "./schema";
export { ApiProblem };
