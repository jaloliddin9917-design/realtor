export default {
  locales: ["uz", "ru"],
  input: ["src/**/*.{ts,tsx}"],
  output: "i18n-extracted/$LOCALE.json",
  keySeparator: ".",
  namespaceSeparator: false,
  defaultValue: "",
  keepRemoved: false,
  // The catalogues use a single base key (e.g. "properties.count") with `{{count}}`
  // interpolation rather than i18next's `_one`/`_other` plural-suffixed keys, so
  // `t("properties.count", { count })` and `t("properties.rooms", { count })` must
  // extract as their bare keys, not `properties.count_one`/`properties.count_other`.
  pluralSeparator: false,
  sort: true,
  createOldCatalogs: false,
  lexers: { ts: ["JavascriptLexer"], tsx: ["JsxLexer"] },
};
