import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { outcomeKey, type CallOutcome, type NextCheckChoice } from "@/entities/call";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import {
  $deposit, $familyOnly, $foreigners, $nextCheck, $nextCheckDate, $note, $outcome, $resultingStatus,
  depositChanged, familyOnlyToggled, foreignersToggled, nextCheckChanged, nextCheckDateChanged,
  noteChanged, outcomeChanged, submitFx, submitRequested,
} from "./model";

const OUTCOMES: CallOutcome[] = ["still_available", "taken", "no_answer", "call_back", "realtor_not_owner", "do_not_contact", "wrong_number"];
const NEXT_CHECKS: NextCheckChoice[] = ["in_3_days", "tomorrow", "date"];
const section = "flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5";
const sectionTitle = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

/** The outcome/conditions/note/next-check form for one queue item's call — features/call/log-result. */
export function LogResultForm({ queueItemId }: { queueItemId: string }) {
  const { t } = useTranslation();
  const [outcome, foreigners, familyOnly, deposit, note, nextCheck, nextCheckDate, resultingStatus, pending] = useUnit([
    $outcome, $foreigners, $familyOnly, $deposit, $note, $nextCheck, $nextCheckDate, $resultingStatus, submitFx.pending,
  ]);
  const [changeOutcome, toggleForeigners, toggleFamilyOnly, changeDeposit, changeNote, changeNextCheck, changeNextCheckDate, submit] = useUnit([
    outcomeChanged, foreignersToggled, familyOnlyToggled, depositChanged, noteChanged, nextCheckChanged, nextCheckDateChanged, submitRequested,
  ]);
  // resultingStatus is only "taken" or "unchanged" once an outcome is picked, so the non-null
  // assertion below is never exercised while outcome is actually null (see call.save's default).
  const statusLabel = t(resultingStatus === "vacant" ? "call.statusVacant" : outcomeKey(outcome!));

  return (
    <div className="flex flex-col gap-3">
      <div className={section}>
        <h2 className={sectionTitle}>{t("call.result.title")}</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {OUTCOMES.map((o) => (
            <Button key={o} type="button" variant={outcome === o ? "default" : "outline"} aria-pressed={outcome === o} onClick={() => changeOutcome(o)}>
              {t(outcomeKey(o))}
            </Button>
          ))}
        </div>
      </div>

      <div className={section}>
        <h2 className={sectionTitle}>{t("call.conditions.title")}</h2>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="foreigners">{t("call.conditions.foreigners")}</Label>
          <Switch id="foreigners" checked={foreigners} onCheckedChange={toggleForeigners} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="deposit">{t("call.conditions.deposit")}</Label>
          <div className="flex items-center gap-1.5">
            <Input id="deposit" inputMode="numeric" className="w-16" value={deposit} onChange={(e) => changeDeposit(e.target.value)} />
            <span className="text-xs text-muted-foreground">{t("call.conditions.depositUnit")}</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="familyOnly">{t("call.conditions.familyOnly")}</Label>
          <Switch id="familyOnly" checked={familyOnly} onCheckedChange={toggleFamilyOnly} />
        </div>
      </div>

      <div className={section}>
        <Label htmlFor="call-note" className={sectionTitle}>{t("call.note.title")}</Label>
        <textarea
          id="call-note"
          value={note}
          onChange={(e) => changeNote(e.target.value)}
          placeholder={t("call.notePlaceholder")}
          maxLength={1000}
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      <div className={section}>
        <h2 className={sectionTitle}>{t("call.nextCheck.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {NEXT_CHECKS.map((c) => (
            <Button key={c} type="button" size="sm" variant={nextCheck === c ? "default" : "outline"} aria-pressed={nextCheck === c} onClick={() => changeNextCheck(c)}>
              {t(`call.nextCheck.${c}`)}
            </Button>
          ))}
          {nextCheck === "date" && (
            <Input type="date" aria-label={t("call.nextCheck.date")} value={nextCheckDate} onChange={(e) => changeNextCheckDate(e.target.value)} className="w-auto" />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button size="lg" disabled={!outcome || pending} onClick={() => submit({ queueItemId })}>
          {t("call.save", { status: statusLabel })}
        </Button>
        <p className="text-center text-xs text-muted-foreground">{t("call.saveFootnote")}</p>
      </div>
    </div>
  );
}
