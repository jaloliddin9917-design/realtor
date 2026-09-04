const LOCALES: Record<string, string> = { uz: "uz-Latn-UZ", ru: "ru-RU" };

/** HH:MM, Asia/Tashkent — mirrors entities/queue/lib.ts's formatTime (entities must not import
 * one another, so this tiny helper is duplicated rather than shared). "—" for a null instant
 * (not sent / no reply yet). */
export function formatTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(LOCALES[locale] ?? "uz-Latn-UZ", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tashkent" }).format(new Date(iso));
}
