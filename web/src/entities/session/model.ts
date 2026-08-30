/**
 * Session state. Stores hold no ambient state of their own: `$tokens` starts at `null`
 * and storage is read explicitly, so that `logout` really empties it (a store whose
 * *default* was read from storage would be restored to those tokens by `.reset()`, and
 * `persistFx` would write them straight back).
 *
 * App start sequence (main.tsx, before mounting):
 *
 *   const scope = fork();
 *   await allSettled(tokensLoaded, { scope, params: loadTokens() });
 *   await allSettled(restoreSessionFx, { scope });
 *
 * `tokensLoaded` seeds `$tokens` inside the scope; `restoreSessionFx` then reads that
 * scoped store (not storage) and validates the tokens with `/me`. Either way it ends in
 * `sessionRestored` — with the user, or with `null` plus a `logout` when there are no
 * tokens or `/me` fails — which is what flips `$sessionChecked` and lets the router
 * decide between the app and the login page.
 */
import { attach, createEffect, createEvent, createStore, sample } from "effector";
import { api, configureAuth, unwrap, type Schemas } from "@/shared/api";
import { TOKEN_STORAGE_KEY } from "@/shared/config";

export interface Tokens { access: string; refresh: string }
type TokenPair = Schemas["TokenPair"];
export type User = Schemas["UserOut"];

/** Reads the persisted tokens; call it once at app start and feed `tokensLoaded`. */
export function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch { return null; }
}

export const logout = createEvent();
export const sessionRestored = createEvent<User | null>();
/** Seeds `$tokens` from storage at app start (see the module docstring). */
export const tokensLoaded = createEvent<Tokens | null>();

export const loginFx = createEffect(async (params: { phone: string; password: string }): Promise<TokenPair> =>
  unwrap(api.POST("/api/v1/auth/login", { body: params })));

export const refreshFx = createEffect(async (refresh: string): Promise<TokenPair> =>
  unwrap(api.POST("/api/v1/auth/refresh", { body: { refresh } })));

export const meFx = createEffect(async (): Promise<User> => unwrap(api.GET("/api/v1/me")));

export const $tokens = createStore<Tokens | null>(null)
  .on([loginFx.doneData, refreshFx.doneData], (_, pair) => ({ access: pair.access, refresh: pair.refresh }))
  .on(tokensLoaded, (_, tokens) => tokens)
  // set explicitly rather than `.reset(logout)`: a reset returns the store to its default,
  // which is only the same thing as "signed out" while the default stays null.
  .on(logout, () => null);

export const $user = createStore<User | null>(null)
  .on(meFx.doneData, (_, user) => user)
  .on(sessionRestored, (_, user) => user)
  .on(logout, () => null);

export const $isAuthorized = $tokens.map((t) => t !== null);
export const $isAdmin = $user.map((u) => u?.role === "admin");
export const $sessionChecked = createStore(false).on(sessionRestored, () => true);

const persistFx = createEffect((tokens: Tokens | null) => {
  if (tokens) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
});
sample({ clock: $tokens, target: persistFx });

/** On app start: validate the loaded tokens with /me; a failure clears the session. */
export const restoreSessionFx = attach({
  source: $tokens,
  // `attach` reads $tokens through the current scope, so a forked scope (tests, SSR) sees
  // its own tokens instead of whatever the module last happened to write to storage.
  effect: async (tokens: Tokens | null): Promise<User | null> => {
    if (!tokens) return null;
    try { return await meFx(); } catch { return null; }
  },
});
sample({ clock: restoreSessionFx.doneData, target: sessionRestored });
sample({ clock: restoreSessionFx.doneData, filter: (u): u is null => u === null, fn: () => undefined, target: logout });

// after a successful login, load the user
sample({ clock: loginFx.done, target: meFx });

// wire the client's auth hooks to this model (non-scoped reads are fine for the token getter)
let currentTokens: Tokens | null = null;
$tokens.watch((t) => { currentTokens = t; });
configureAuth({
  getAccess: () => currentTokens?.access ?? null,
  refresh: async () => {
    if (!currentTokens) return null;
    try {
      const pair = await refreshFx(currentTokens.refresh);
      return pair.access;
    } catch {
      logout();
      return null;
    }
  },
});
