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
  {
    // Same shape as `features/auth/login` above: each of these owns its own Effector model
    // (request event, effect, error store) tightly coupled to one dialog/control, and
    // `pages/admin-sources` is — by design — the only page that composes them. `toggle` and
    // `add-telegram` stay features (not inlined into the page) so the page only wires
    // behaviour together; `sources-table` stays a widget (not a feature) because it renders
    // entity data plus a `renderToggle` render prop rather than owning a feature import
    // itself — widgets never import features. "warn" rather than "off" for the same reason
    // as the other overrides here: still visible, not a hard failure.
    files: ["src/features/source/toggle/**", "src/features/source/add-telegram/**", "src/features/source/run-now/**", "src/widgets/sources-table/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // The list filters own effector units (the URL-synced stores, `querySync`, the fetch
    // trigger) and are rendered as three separate bars the page places around the results,
    // so they are a feature — but only the properties page can render them, which is what
    // `insignificant-slice` reacts to. Merging would move a model into pages/, the wrong
    // direction; "warn" rather than "off" for the same reason as features/auth/login above.
    files: ["src/features/property/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // `features/listing/add-manual` (the *Qo'lda qo'shish* dialog) owns its own Effector
    // model (`addUrlRequested`, `addUrlFx`, `$urlError`) tightly coupled to one dialog, the
    // same shape as `features/auth/login` and `features/source/*` above — and, since Task 7
    // wired its button into `pages/properties`, that page is its only consumer. The slice is
    // no longer a zero-reference orphan, but `insignificant-slice` also fires for a slice
    // with exactly one reference ("consider merging them"), which would mean moving the
    // dialog's model into pages/ — the wrong direction, for the same reason as the other
    // single-consumer features here. "warn" rather than "off" for the same reason as the
    // rest of this file: still visible, not a hard failure.
    files: ["src/features/listing/add-manual/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // The table (≥ lg) and the card list (< lg) are two renderings of the same rows, and the
    // page picks between them with CSS — so each has exactly one consumer by construction.
    // They stay separate widgets because either one is a self-contained block of markup that
    // the page merely places; folding both into pages/properties would make that one file the
    // whole list UI. "warn" keeps the report honest without failing the gate.
    files: ["src/widgets/property-table/**", "src/widgets/property-card-list/**"],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // The property page's four blocks (photos + price, the listings, the contacts, the status
    // history) and the two entity rows they render. Only one page can ever show a property's
    // detail, so each of these has exactly one consumer by construction — but folding them
    // into pages/property would make that single file the whole screen, and `entities/listing`
    // / `entities/contact` are the API's own nouns, reused by whatever later shows a listing
    // or a contact outside this page. "warn" rather than "off" for the same reason as the
    // overrides above: still visible in the report, not a hard failure.
    files: [
      "src/entities/listing/**",
      "src/entities/contact/**",
      "src/widgets/property-header/**",
      "src/widgets/listings-list/**",
      "src/widgets/contacts-list/**",
      "src/widgets/status-timeline/**",
    ],
    rules: {
      "fsd/insignificant-slice": "warn",
    },
  },
  {
    // The six remaining mockup screens (dashboard, queue, call log, duplicates, bot monitor,
    // settings). Each screen's data/effector entity and its action features are consumed by
    // exactly one page by construction — the same single-consumer shape as every override
    // above — so `insignificant-slice` (and, where a slice sits beside a like-named segment,
    // `ambiguous-slice-names`) would fire. "warn" keeps them visible without failing the gate,
    // consistent with the rest of this file. Widgets for these screens live as local page
    // components under `pages/<screen>/ui/` and so need no slice override.
    files: [
      "src/entities/queue/**", "src/entities/call/**", "src/entities/dashboard/**",
      "src/entities/duplicate/**", "src/entities/bot/**", "src/entities/agent/**",
      "src/entities/setting/**", "src/entities/settings/**",
      "src/features/queue/**", "src/features/call/**", "src/features/dashboard/**",
      "src/features/duplicate/**", "src/features/bot/**", "src/features/settings/**",
      "src/widgets/queue-list/**", "src/widgets/duplicate-compare/**",
      "src/widgets/bot-table/**", "src/widgets/settings-panel/**", "src/widgets/dashboard-board/**",
    ],
    rules: {
      "fsd/insignificant-slice": "warn",
      "fsd/ambiguous-slice-names": "warn",
    },
  },
]);
