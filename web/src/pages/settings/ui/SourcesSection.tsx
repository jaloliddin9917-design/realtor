import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $sources, type Source } from "@/entities/source";
import { kindKey, sourceStatusKey } from "@/shared/i18n";
import { formatDate } from "@/shared/lib";

/**
 * The real `Source` shape (kind/enabled/status/last_run) has no per-kind sentence template the
 * way the old mock's `SourceFeed` did, so this composes one line per source from the same
 * `sources.*` copy the admin sources table (`widgets/sources-table`) already uses, rather than
 * adding new i18n keys for a shape the mock invented. Read-only overview: adding a channel lives
 * on the real Sources screen (/admin/sources) — there is no "add channel" dialog here.
 */
function sourceLine(t: (key: string, opts?: Record<string, unknown>) => string, lang: string, s: Source): string {
  const state = t(s.enabled ? "sources.enabled" : "sources.disabled");
  const status = t(sourceStatusKey(s.status));
  const lastRun = s.last_run
    ? `${formatDate(s.last_run.started_at, lang, "datetime")} · ${t("sources.columns.found")} ${s.last_run.found} · ${t("sources.columns.new")} ${s.last_run.new}`
    : t("sources.never");
  return `${s.name} — ${t(kindKey(s.kind))} · ${state} · ${status} · ${lastRun}`;
}

export function SourcesSection() {
  const { t, i18n } = useTranslation();
  const sources = useUnit($sources);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <h2 className="text-base font-semibold">{t("sources.title")}</h2>
      <ul className="flex flex-col gap-2">
        {sources.map((s) => (
          <li key={s.id} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2 text-[13px]">{sourceLine(t, i18n.language, s)}</li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{t("settingsPage.sources.noteGone")}</p>
        <p>{t("settingsPage.sources.notePhash")}</p>
      </div>
    </div>
  );
}
