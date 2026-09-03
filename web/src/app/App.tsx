import { RouterProvider, Route } from "atomic-router-react";
import { Provider } from "effector-react";
import { fork } from "effector";
import { Toaster } from "@/shared/ui/sonner";
import { router, routes } from "@/shared/router";
import { authorized } from "./router";
import { LoginPage } from "@/pages/login";
import { DashboardPage } from "@/pages/dashboard";
import { PropertiesPage } from "@/pages/properties";
import { PropertyPage } from "@/pages/property";
import { QueuePage } from "@/pages/queue";
import { CallPage } from "@/pages/call";
import { DuplicatesPage } from "@/pages/duplicates";
import { BotMonitorPage } from "@/pages/bot-monitor";
import { SettingsPage } from "@/pages/settings";
import { AdminSourcesPage } from "@/pages/admin-sources";

export const scope = fork();

export function App() {
  return (
    <Provider value={scope}>
      <RouterProvider router={router}>
        <Route route={routes.login} view={LoginPage} />
        <Route route={authorized.dashboard} view={DashboardPage} />
        <Route route={authorized.properties} view={PropertiesPage} />
        <Route route={authorized.property} view={PropertyPage} />
        <Route route={authorized.queue} view={QueuePage} />
        <Route route={authorized.call} view={CallPage} />
        <Route route={authorized.duplicates} view={DuplicatesPage} />
        <Route route={authorized.botMonitor} view={BotMonitorPage} />
        <Route route={authorized.settings} view={SettingsPage} />
        <Route route={authorized.adminSources} view={AdminSourcesPage} />
        <Toaster position="top-right" />
      </RouterProvider>
    </Provider>
  );
}
