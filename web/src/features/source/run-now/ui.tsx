import { useUnit } from "effector-react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Source } from "@/entities/source";
import { Button } from "@/shared/ui/button";
import { runFx, runRequested } from "./model";

/** A disabled source can't be crawled — the worker skips it — so the button is disabled too. */
export function SourceRunNow({ source }: { source: Pick<Source, "id" | "enabled"> }) {
  const { t } = useTranslation();
  const [request, pending] = useUnit([runRequested, runFx.pending]);
  return (
    <Button size="sm" variant="secondary" disabled={!source.enabled || pending} onClick={() => request(source.id)}>
      <RefreshCw className="size-4" />{t("sources.runNow")}
    </Button>
  );
}
