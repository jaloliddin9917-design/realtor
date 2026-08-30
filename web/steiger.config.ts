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
  {
    // The login form is a feature (it owns effector units and drives loginFx) but only one
    // page can ever render it, so `insignificant-slice`'s "consider merging them" advice
    // would mean moving a feature's model into pages/ — the wrong direction. "warn" rather
    // than "off" for the same reason as above: it stays visible without failing the gate.
    files: ["src/features/auth/login/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // `features/i18n/switch-language` (the UZ/RU toggle) sits next to the `shared/i18n`
    // segment (the i18next instance and key helpers), which `ambiguous-slice-names` reads as
    // a possible mix-up. They are deliberately named after the same concern at two layers,
    // and `@/features/i18n/switch-language` is the import path the rest of M0-4 is written
    // against, so the group keeps its name.
    files: ["src/features/i18n/**"],
    rules: {
      "fsd/ambiguous-slice-names": "warn",
    },
  },
]);
