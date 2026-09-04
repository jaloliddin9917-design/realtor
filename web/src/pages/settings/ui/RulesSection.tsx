import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $meta } from "@/entities/meta";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-0">
      <span className="text-[13px] text-ink">{label}</span>
      <span className="num text-sm font-medium">{value}</span>
    </div>
  );
}

/**
 * Read-only: the backend enforces these constants in code (see `RulesOut`'s docstring on the
 * schema) and has no persistence endpoint for them, so — unlike the old mock's editable form —
 * there is nothing here to edit or save. Quiet-hours and per-contact caps are gone along with
 * the mock: the backend doesn't enforce either, so showing controls for them would promise a
 * guarantee that isn't real.
 */
export function RulesSection() {
  const { t } = useTranslation();
  const meta = useUnit($meta);
  const rules = meta?.rules ?? null;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold">{t("settingsPage.rules.title")}</h2>
      {rules && (
        <div className="flex flex-col">
          <Row label={t("settingsPage.rules.lockHours")} value={`${rules.lock_hours} ${t("settingsPage.rules.hours")}`} />
          <Row label={t("settingsPage.rules.recheckDays")} value={`${rules.recheck_days} ${t("settingsPage.rules.days")}`} />
          <Row label={t("settingsPage.rules.newListingCheck")} value={`${rules.new_listing_check_days} ${t("settingsPage.rules.afterDaysSuffix")}`} />
          <Row label={t("settingsPage.rules.duplicateThreshold")} value={`≥ ${rules.duplicate_merge_threshold}`} />
          <Row label={t("settingsPage.rules.telegramLimit")} value={t("bot.cards.limits", { perHour: rules.telegram_per_hour ?? "—", perDay: rules.telegram_per_day ?? "—" })} />
          <Row label={t("settingsPage.rules.smsLimit")} value={rules.sms_per_day === null ? "—" : t("settingsPage.rules.perDayValue", { count: rules.sms_per_day })} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("settingsPage.rules.readOnlyNote")}</p>
    </div>
  );
}
