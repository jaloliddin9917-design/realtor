import React from "react";
import ReactDOM from "react-dom/client";
import { allSettled } from "effector";
import { createBrowserHistory } from "history";
import { App, scope } from "./app/App";
import { router } from "@/shared/router";
import { i18nReady } from "@/shared/i18n";
import { loadTokens, tokensLoaded } from "@/entities/session";
import "./app/styles/globals.css";

async function start() {
  await i18nReady;
  // `$tokens` has to be seeded inside the scope before the router runs its guard:
  // `restoreSessionFx` reads the scoped store, not localStorage (see entities/session).
  await allSettled(tokensLoaded, { scope, params: loadTokens() });
  await allSettled(router.setHistory, { scope, params: createBrowserHistory() });
  ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
}
void start();
