import { defineConfig } from "steiger";
import fsd from "@feature-sliced/steiger-plugin";

export default defineConfig([
  ...fsd.configs.recommended,
  {
    // Scoped to this one slice: M0-4 builds the FSD layers bottom-up across sequential
    // tasks (entities land before the features/pages that consume them — see
    // .superpowers/sdd/progress.md), so entities/session, added by task 2, has zero
    // external references until the auth/session pages a later task adds wire it in.
    // Kept as "warn" rather than "off" so a slice that is STILL orphaned once the app is
    // fully wired stays visible, and left at "error" everywhere else so the next orphan
    // slice is a hard failure rather than a silent one.
    files: ["src/entities/session/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
]);
