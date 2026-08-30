const DASH = "—";
const LOCALES: Record<string, string> = { uz: "uz-Latn-UZ", ru: "ru-RU" };

export function formatDate(iso: string | null, locale: string, mode: "date" | "datetime" = "date"): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const options: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(LOCALES[locale] ?? "uz-Latn-UZ", { ...options, timeZone: "Asia/Tashkent" }).format(d);
}
