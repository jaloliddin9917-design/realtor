import { chainRoute, redirect, type RouteInstance, type RouteParams, type RouteParamsAndQuery } from "atomic-router";
import { createEvent, sample } from "effector";
import { and, not } from "patronum";
import { agentsReceived, mapAgentToday } from "@/entities/agent";
import { fetchDashboardFx } from "@/entities/dashboard";
import { $meta, loadMetaFx } from "@/entities/meta";
import { detailCleared, fetchPropertyFx } from "@/entities/property";
import { $isAdmin, $isAuthorized, $sessionChecked, loginFx, logout, restoreSessionFx, sessionRestored } from "@/entities/session";
import { fetchQueueFx } from "@/entities/queue";
import { fetchUsersFx } from "@/entities/setting";
import { fetchSourcesFx } from "@/entities/source";
import { router, routes } from "@/shared/router";

export function chainAuthorized<P extends RouteParams>(route: RouteInstance<P>): RouteInstance<P> {
  const checkStarted = createEvent<RouteParamsAndQuery<P>>();
  const alreadyAuthorized = sample({ clock: checkStarted, filter: and($sessionChecked, $isAuthorized) });
  const alreadyAnonymous = sample({ clock: checkStarted, filter: and($sessionChecked, not($isAuthorized)) });
  sample({ clock: checkStarted, filter: not($sessionChecked), target: restoreSessionFx });
  const restoredAuthorized = sample({ clock: sessionRestored, filter: (u) => u !== null });
  const restoredAnonymous = sample({ clock: sessionRestored, filter: (u) => u === null });
  redirect({ clock: [alreadyAnonymous, restoredAnonymous], route: routes.login, replace: true });
  return chainRoute({ route, beforeOpen: checkStarted, openOn: [alreadyAuthorized, restoredAuthorized], cancelOn: [alreadyAnonymous, restoredAnonymous] });
}

export function chainAdmin<P extends RouteParams>(route: RouteInstance<P>): RouteInstance<P> {
  const inner = chainAuthorized(route);
  const checkStarted = createEvent<RouteParamsAndQuery<P>>();
  const admin = sample({ clock: checkStarted, filter: $isAdmin });
  const notAdmin = sample({ clock: checkStarted, filter: not($isAdmin) });
  redirect({ clock: notAdmin, route: routes.properties, replace: true });
  return chainRoute({ route: inner, beforeOpen: checkStarted, openOn: admin, cancelOn: notAdmin });
}

export const authorized = {
  dashboard: chainAuthorized(routes.dashboard),
  properties: chainAuthorized(routes.properties),
  property: chainAuthorized(routes.property),
  queue: chainAuthorized(routes.queue),
  call: chainAuthorized(routes.call),
  duplicates: chainAuthorized(routes.duplicates),
  botMonitor: chainAuthorized(routes.botMonitor),
  settings: chainAdmin(routes.settings),
  adminSources: chainAdmin(routes.adminSources),
};

// `replace` throughout: a guard bounce is not a place the back button should return to.
redirect({ clock: loginFx.done, route: routes.properties, replace: true });
redirect({ clock: logout, route: routes.login, replace: true });
// a logged-in visitor on /login goes straight to the list
redirect({ clock: sample({ clock: routes.login.opened, filter: $isAuthorized }), route: routes.properties, replace: true });
// an unknown path lands on the list, with the address bar corrected (see shared/router)
redirect({ clock: router.routeNotFound, route: routes.properties, replace: true });

// load the admin sources list (and FX rate) whenever /admin/sources opens
sample({ clock: authorized.adminSources.opened, target: fetchSourcesFx });

// load the agent queue whenever /queue opens
sample({ clock: authorized.queue.opened, target: fetchQueueFx });

// load the dashboard whenever /dashboard opens — one fetch feeds both entities/dashboard's
// stats and entities/agent's board (entities must not import one another, so this is the one
// place allowed to know about both; see the module docstrings on each).
sample({ clock: authorized.dashboard.opened, target: fetchDashboardFx });
sample({ clock: fetchDashboardFx.doneData, fn: (d) => d.agents.map(mapAgentToday), target: agentsReceived });

// load the users and sources overviews whenever /settings opens (sources reuses the same
// fetchSourcesFx/$sources as /admin/sources — entities/source is real data throughout, no mock)
sample({ clock: authorized.settings.opened, target: fetchUsersFx });
sample({ clock: authorized.settings.opened, target: fetchSourcesFx });

// Load the property on `opened` *and* `updated`: atomic-router only fires `opened` the first
// time the route matches, so navigating straight from one property to another (the path stays
// `/properties/:id`, only the param changes) fires `updated` instead — hooking `opened` alone
// would leave the previous property on screen under the new URL. Both clocks clear the detail
// first, so the new property's loading state renders rather than a stale flash of the one just
// left; `closed` drops it entirely on the way out.
sample({ clock: [authorized.property.opened, authorized.property.updated], target: detailCleared });
sample({ clock: [authorized.property.opened, authorized.property.updated], fn: ({ params }) => params.id, target: fetchPropertyFx });
sample({ clock: authorized.property.closed, target: detailCleared });

/**
 * The API's enumerations (districts, statuses, source kinds) are fetched once per session,
 * on the first authorized page that opens. It is wired here rather than in entities/meta
 * because entities must not import one another and none of them knows about the routes —
 * the app layer is the one place allowed to know both.
 */
sample({
  clock: [authorized.properties.opened, authorized.property.opened, authorized.adminSources.opened],
  source: $meta,
  filter: (meta) => meta === null,
  fn: () => undefined,
  target: loadMetaFx,
});
