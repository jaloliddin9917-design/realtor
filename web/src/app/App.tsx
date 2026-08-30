import { RouterProvider, Route } from "atomic-router-react";
import { Provider } from "effector-react";
import { fork } from "effector";
import { Toaster } from "@/shared/ui/sonner";
import { router, routes } from "@/shared/router";
import { authorized } from "./router";
import { LoginPage } from "@/pages/login";
import { PropertiesPage } from "@/pages/properties";
import { PropertyPage } from "@/pages/property";
import { AdminSourcesPage } from "@/pages/admin-sources";

export const scope = fork();

export function App() {
  return (
    <Provider value={scope}>
      <RouterProvider router={router}>
        <Route route={routes.login} view={LoginPage} />
        <Route route={authorized.properties} view={PropertiesPage} />
        <Route route={authorized.property} view={PropertyPage} />
        <Route route={authorized.adminSources} view={AdminSourcesPage} />
        <Toaster position="top-right" />
      </RouterProvider>
    </Provider>
  );
}
