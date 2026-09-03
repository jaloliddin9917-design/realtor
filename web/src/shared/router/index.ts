import { createHistoryRouter, createRoute, createRouterControls, type ParamsSerializer } from "atomic-router";

export const routes = {
  login: createRoute(),
  dashboard: createRoute(),
  properties: createRoute(),
  property: createRoute<{ id: string }>(),
  queue: createRoute(),
  call: createRoute<{ id: string }>(),
  duplicates: createRoute(),
  botMonitor: createRoute(),
  settings: createRoute(),
  adminSources: createRoute(),
};

/**
 * The router's read/write channel for the query string. `querySync` (features/property/filters)
 * takes it as a required `controls` argument and it has to be the very instance the router was
 * built with — otherwise the router would create its own and the two would never meet.
 */
export const controls = createRouterControls();

/**
 * Query serialization. atomic-router falls back to `new URLSearchParams(query)` — an *object*,
 * which is truthy even when it stringifies to "", so an emptied query pushes `/properties?`
 * and leaves a bare `?` in the address bar (and in `history.location.search`). Writing the
 * string ourselves makes the empty case falsy, so clearing every filter really returns to
 * `/properties`. `read` is the same parse the router would do by default.
 */
const serialize: ParamsSerializer = {
  write: (query) => new URLSearchParams(query).toString(),
  read: (search) => Object.fromEntries(new URLSearchParams(search)),
};

/**
 * No `notFoundRoute`: atomic-router closes that route again whenever a real route matches,
 * so naming a mapped route (`routes.properties`) as the fallback makes `/properties` open
 * and immediately close itself. `app/router.ts` redirects `router.routeNotFound` to
 * `/properties` instead, which also corrects the address bar rather than rendering the list
 * under an unknown URL.
 */
export const router = createHistoryRouter({
  controls,
  serialize,
  routes: [
    { path: "/login", route: routes.login },
    { path: "/dashboard", route: routes.dashboard },
    { path: "/properties", route: routes.properties },
    { path: "/properties/:id", route: routes.property },
    { path: "/queue", route: routes.queue },
    { path: "/queue/:id", route: routes.call },
    { path: "/duplicates", route: routes.duplicates },
    { path: "/bot", route: routes.botMonitor },
    { path: "/settings", route: routes.settings },
    { path: "/admin/sources", route: routes.adminSources },
  ],
});
