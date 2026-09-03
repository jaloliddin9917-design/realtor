import { useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $rules, type Rules } from "@/entities/setting";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { saveRequested, saveRulesFx } from "./model";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-0">
      <Label className="text-[13px] font-normal text-ink">{label}</Label>
      <div className="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

const num = "num h-8 w-20 text-right";
const unit = "text-xs text-muted-foreground";

/** The "Chegaralar va qoidalar" form: local, uncontrolled-by-the-store state until Saqlash is pressed. */
export function RulesForm() {
  const { t } = useTranslation();
  const [rules, save, pending] = useUnit([$rules, saveRequested, saveRulesFx.pending]);
  const [form, setForm] = useState<Rules>(rules);
  const set = <K extends keyof Rules>(key: K, value: Rules[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form className="flex flex-col" onSubmit={(e) => { e.preventDefault(); save(form); }}>
      <Row label={t("settingsPage.rules.lockHours")}>
        <Input type="number" min={0} className={num} value={form.lock_hours} onChange={(e) => set("lock_hours", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.lockHours")} />
        <span className={unit}>{t("settingsPage.rules.hours")}</span>
      </Row>
      <Row label={t("settingsPage.rules.recheckDays")}>
        <Input type="number" min={0} className={num} value={form.recheck_days} onChange={(e) => set("recheck_days", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.recheckDays")} />
        <span className={unit}>{t("settingsPage.rules.days")}</span>
      </Row>
      <Row label={t("settingsPage.rules.quietHours")}>
        <Input type="time" className="h-8 w-28" value={form.quiet_start} onChange={(e) => set("quiet_start", e.target.value)} aria-label={t("settingsPage.rules.quietHours")} />
        <span className={unit}>–</span>
        <Input type="time" className="h-8 w-28" value={form.quiet_end} onChange={(e) => set("quiet_end", e.target.value)} aria-label={t("settingsPage.rules.quietHours")} />
      </Row>
      <Row label={t("settingsPage.rules.perContact")}>
        <Input type="number" min={0} className="num h-8 w-14 text-right" value={form.per_contact_count} onChange={(e) => set("per_contact_count", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.perContact")} />
        <span className={unit}>/</span>
        <Input type="number" min={0} className="num h-8 w-14 text-right" value={form.per_contact_days} onChange={(e) => set("per_contact_days", Number(e.target.value) || 0)} />
        <span className={unit}>{t("settingsPage.rules.days")}</span>
      </Row>
      <Row label={t("settingsPage.rules.dailyLimit")}>
        <Input type="number" min={0} className={num} value={form.daily_limit_per_channel} onChange={(e) => set("daily_limit_per_channel", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.dailyLimit")} />
        <span className={unit}>{t("settingsPage.rules.messages")}</span>
      </Row>
      <Row label={t("settingsPage.rules.newListingCheck")}>
        <Input type="number" min={0} className={num} value={form.new_listing_check_days} onChange={(e) => set("new_listing_check_days", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.newListingCheck")} />
        <span className={unit}>{t("settingsPage.rules.afterDaysSuffix")}</span>
      </Row>
      <Row label={t("settingsPage.rules.duplicateThreshold")}>
        <span className={unit}>≥</span>
        <Input type="number" min={0} max={1} step={0.05} className={num} value={form.duplicate_threshold} onChange={(e) => set("duplicate_threshold", Number(e.target.value) || 0)} aria-label={t("settingsPage.rules.duplicateThreshold")} />
      </Row>
      <Button type="submit" className="mt-3 self-end" disabled={pending}>{t("app.save")}</Button>
    </form>
  );
}
