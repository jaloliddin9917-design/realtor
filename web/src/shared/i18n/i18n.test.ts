import ru from "./ru.json";
import uz from "./uz.json";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "object" && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe("translations", () => {
  it("uz and ru have identical key sets", () => {
    expect(keys(ru).sort()).toEqual(keys(uz).sort());
  });
  it("cover every enumerated API value", () => {
    const k = new Set(keys(uz));
    for (const s of ["new", "active", "inactive"]) expect(k.has(`status.${s}`)).toBe(true);
    for (const s of ["olx", "telegram", "manual"]) expect(k.has(`kind.${s}`)).toBe(true);
    for (const s of ["owner", "agent", "unknown"]) expect(k.has(`classification.${s}`)).toBe(true);
    for (const s of ["crawler", "agent", "admin", "bot"]) expect(k.has(`actor.${s}`)).toBe(true);
    for (const s of ["ok", "failing", "login_required", "paused", "misconfigured"]) expect(k.has(`sources.status.${s}`)).toBe(true);
    // the 12 canonical districts of backend/app/ingestion/parse/districts.py (GET /api/v1/meta returns them at runtime)
    for (const d of ["bektemir", "chilonzor", "mirobod", "mirzo_ulugbek", "olmazor", "sergeli", "shayxontohur", "uchtepa", "yakkasaroy", "yangihayot", "yashnobod", "yunusobod"]) expect(k.has(`district.${d}`)).toBe(true);
    for (const c of ["auth.missing_token", "auth.token_expired", "auth.token_invalid", "auth.user_inactive", "auth.invalid_credentials", "auth.forbidden", "not_found", "method_not_allowed", "validation_error", "internal_error", "listing.unsupported_url", "listing.invalid_url", "listing.gone", "source.misconfigured", "source.unavailable", "source.login_required", "source.peer_unresolved", "source.exists"]) expect(k.has(`errors.${c}`)).toBe(true);
  });
});
