import type { TFunction } from "i18next";
import { formatPhone } from "@/shared/lib";
import type { QueueOwner } from "./api";

const LOCALES: Record<string, string> = { uz: "uz-Latn-UZ", ru: "ru-RU" };

/** HH:MM, Asia/Tashkent — mirrors shared/lib/date.ts's locale mapping and time zone. */
export function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(LOCALES[locale] ?? "uz-Latn-UZ", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tashkent" }).format(new Date(iso));
}

/**
 * "N daqiqa oldin" / "N soat oldin" / "kecha HH:MM" / "N kun oldin", relative to now.
 * Bucketed purely on elapsed hours (not calendar-day boundaries) so it stays correct
 * regardless of what time of day the queue happens to be opened.
 */
export function relativeLabel(iso: string, locale: string, t: TFunction): string {
  const diffMin = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (diffMin < 60) return t("queue.relative.minutes", { count: diffMin });
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return t("queue.relative.hours", { count: diffHour });
  if (diffHour < 48) return t("queue.relative.yesterday", { time: formatTime(iso, locale) });
  return t("queue.relative.days", { count: Math.round(diffHour / 24) });
}

/** The card's owner line: unknown / a probable owner's phone / a realtor's home count. */
export function ownerLine(owner: QueueOwner, t: TFunction): string {
  if (owner.classification === "agent") return t("queue.ownerAgent", { count: owner.homeCount ?? 0 });
  if (owner.classification === "owner") return t("queue.ownerPhone", { phone: formatPhone(owner.phone) });
  return t("queue.ownerUnknown");
}
