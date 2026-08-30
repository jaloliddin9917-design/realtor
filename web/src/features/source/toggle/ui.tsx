import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/shared/ui/switch";
import type { Source } from "@/entities/source";
import { toggleFx, toggleRequested } from "./model";

export function SourceToggle({ source }: { source: Pick<Source, "id" | "enabled"> }) {
  const { t } = useTranslation();
  const [request, pending] = useUnit([toggleRequested, toggleFx.pending]);
  return <Switch checked={source.enabled} disabled={pending} aria-label={source.enabled ? t("sources.enabled") : t("sources.disabled")} onCheckedChange={(enabled) => request({ id: source.id, enabled })} />;
}
