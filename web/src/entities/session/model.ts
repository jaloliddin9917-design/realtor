import { createEffect, createEvent, createStore, sample } from "effector";
import { api, configureAuth, unwrap, type Schemas } from "@/shared/api";
import { TOKEN_STORAGE_KEY } from "@/shared/config";

export interface Tokens { access: string; refresh: string }
type TokenPair = Schemas["TokenPair"];
export type User = Schemas["UserOut"];

function loadTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch { return null; }
}

export const logout = createEvent();
export const sessionRestored = createEvent<User | null>();

export const loginFx = createEffect(async (params: { phone: string; password: string }): Promise<TokenPair> =>
  unwrap(api.POST("/api/v1/auth/login", { body: params })));

export const refreshFx = createEffect(async (refresh: string): Promise<TokenPair> =>
  unwrap(api.POST("/api/v1/auth/refresh", { body: { refresh } })));

export const meFx = createEffect(async (): Promise<User> => unwrap(api.GET("/api/v1/me")));

export const $tokens = createStore<Tokens | null>(loadTokens())
  .on([loginFx.doneData, refreshFx.doneData], (_, pair) => ({ access: pair.access, refresh: pair.refresh }))
  .reset(logout);

export const $user = createStore<User | null>(null)
  .on(meFx.doneData, (_, user) => user)
  .on(sessionRestored, (_, user) => user)
  .reset(logout);

export const $isAuthorized = $tokens.map((t) => t !== null);
export const $isAdmin = $user.map((u) => u?.role === "admin");
export const $sessionChecked = createStore(false).on(sessionRestored, () => true);

const persistFx = createEffect((tokens: Tokens | null) => {
  if (tokens) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
});
sample({ clock: $tokens, target: persistFx });

/** On app start: validate stored tokens by loading /me; a failure clears the session. */
export const restoreSessionFx = createEffect(async (): Promise<User | null> => {
  if (!loadTokens()) return null;
  try { return await meFx(); } catch { return null; }
});
sample({ clock: restoreSessionFx.doneData, target: sessionRestored });
sample({ clock: restoreSessionFx.doneData, filter: (u): u is null => u === null, fn: () => undefined, target: logout });

// after a successful login, load the user
sample({ clock: loginFx.done, target: meFx });

// wire the client's auth hooks to this model (non-scoped reads are fine for the token getter)
let currentTokens: Tokens | null = loadTokens();
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
