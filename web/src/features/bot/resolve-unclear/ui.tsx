import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { resolveFx, resolveRequested } from "./model";

/** The two small resolve buttons shown on an "unclear" outreach row's Amal cell. */
export function ResolveUnclearButtons({ id }: { id: string }) {
  const { t } = useTranslation();
  const [resolve, pending] = useUnit([resolveRequested, resolveFx.pending]);
  return (
    <div className="flex gap-1">
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => resolve({ id, result: "vacant" })}>{t("bot.result.vacant")}</Button>
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => resolve({ id, result: "taken" })}>{t("bot.result.taken")}</Button>
    </div>
  );
}
