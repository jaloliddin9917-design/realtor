// Fails when src/shared/api/schema.d.ts is stale relative to ../backend/openapi.json (spec §8/§12).
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const committed = "src/shared/api/schema.d.ts";
const dir = mkdtempSync(join(tmpdir(), "openapi-"));
const fresh = join(dir, "schema.d.ts");
try {
  execFileSync("pnpm", ["exec", "openapi-typescript", "../backend/openapi.json", "-o", fresh], { stdio: "pipe" });
  if (readFileSync(committed, "utf8") !== readFileSync(fresh, "utf8")) {
    console.error(`${committed} is stale — run \`pnpm api:generate\` (after \`make openapi\` in the backend) and commit.`);
    process.exit(1);
  }
  console.log("api client is current");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
