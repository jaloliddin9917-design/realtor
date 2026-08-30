import { createHistoryRouter, createRoute } from "atomic-router";

export const routes = {
  login: createRoute(),
  properties: createRoute(),
  property: createRoute<{ id: string }>(),
  adminSources: createRoute(),
};

/**
 * No `notFoundRoute`: atomic-router closes that route again whenever a real route matches,
 * so naming a mapped route (`routes.properties`) as the fallback makes `/properties` open
 * and immediately close itself. `app/router.ts` redirects `router.routeNotFound` to
 * `/properties` instead, which also corrects the address bar rather than rendering the list
 * under an unknown URL.
 */
export const router = createHistoryRouter({
  routes: [
    { path: "/login", route: routes.login },
    { path: "/properties", route: routes.properties },
    { path: "/properties/:id", route: routes.property },
    { path: "/admin/sources", route: routes.adminSources },
  ],
});
