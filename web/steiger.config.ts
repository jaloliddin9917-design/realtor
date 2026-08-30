import { defineConfig } from "steiger";
import fsd from "@feature-sliced/steiger-plugin";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // M0-4 builds the FSD layers bottom-up across sequential tasks (entities land
      // before the features/pages that consume them — see .superpowers/sdd/progress.md),
      // so a freshly added slice is expected to have zero external references until a
      // later task wires it in (e.g. entities/session, added by task 2, is consumed by
      // the auth/session pages/features a later task adds). Kept as "warn" rather than
      // "off" so a slice that is STILL orphaned once the app is fully wired stays visible.
      "fsd/insignificant-slice": "warn",
    },
  },
]);
