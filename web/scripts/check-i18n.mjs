// Every key used in code must exist in both catalogues, and the catalogues must have the same key set.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
rmSync("i18n-extracted", { recursive: true, force: true });
execFileSync("pnpm", ["exec", "i18next", "-c", "i18next-parser.config.js", "--silent"], { stdio: "inherit" });
const used = new Set(flatten(JSON.parse(readFileSync("i18n-extracted/uz.json", "utf8"))));
const uz = new Set(flatten(JSON.parse(readFileSync("src/shared/i18n/uz.json", "utf8"))));
const ru = new Set(flatten(JSON.parse(readFileSync("src/shared/i18n/ru.json", "utf8"))));
rmSync("i18n-extracted", { recursive: true, force: true });

const problems = [];
for (const k of used) { if (!uz.has(k)) problems.push(`missing in uz.json: ${k}`); if (!ru.has(k)) problems.push(`missing in ru.json: ${k}`); }
for (const k of uz) if (!ru.has(k)) problems.push(`only in uz.json: ${k}`);
for (const k of ru) if (!uz.has(k)) problems.push(`only in ru.json: ${k}`);
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`i18n ok: ${used.size} keys used in code, ${uz.size} keys in each catalogue`);
