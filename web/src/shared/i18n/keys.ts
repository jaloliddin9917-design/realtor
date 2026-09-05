import uz from "./uz.json";

/** Keys for enumerated API values — one place, so the i18n check and the UI agree. */
export const statusKey = (s: string) => `status.${s}`;
export const kindKey = (k: string) => `kind.${k}`;
export const classificationKey = (c: string) => `classification.${c}`;
export const districtKey = (d: string) => `district.${d}`;
export const buildingTypeKey = (v: string) => `buildingType.${v}`;
export const renovationKey = (v: string) => `renovation.${v}`;
export const bathroomTypeKey = (v: string) => `bathroomType.${v}`;
export const actorKey = (a: string) => `actor.${a}`;
export const sourceStatusKey = (s: string) => `sources.status.${s}`;

function hasKey(path: string): boolean {
  let node: unknown = uz;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object" || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string";
}

/** `errors.<code>` when the catalogue knows the code, else `errors.unknown`. */
export function problemKey(code: string): string {
  const key = `errors.${code}`;
  return hasKey(key) ? key : "errors.unknown";
}
