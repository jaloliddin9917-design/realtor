import { chainRoute, redirect, type RouteInstance, type RouteParams, type RouteParamsAndQuery } from "atomic-router";
import { createEvent, sample } from "effector";
import { and, not } from "patronum";
import { $meta, loadMetaFx } from "@/entities/meta";
import { detailCleared, fetchPropertyFx } from "@/entities/property";
import { $isAdmin, $isAuthorized, $sessionChecked, loginFx, logout, restoreSessionFx, sessionRestored } from "@/entities/session";
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
  properties: chainAuthorized(routes.properties),
  property: chainAuthorized(routes.property),
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

// load the property whenever /properties/:id opens, and drop it again on the way out so the
// next property never renders the previous one's photos while its own request is in flight
sample({ clock: authorized.property.opened, fn: ({ params }) => params.id, target: fetchPropertyFx });
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
