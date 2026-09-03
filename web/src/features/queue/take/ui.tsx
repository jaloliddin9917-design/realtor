import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { takeRequested } from "./model";

/** The New card's "Olish va qo'ng'iroq qilish" and the Retry card's "Qayta urinish" buttons —
 * same action (lock it as mine, then open the call-log screen), different label. */
export function TakeButton({ id, variant, className }: { id: string; variant: "new" | "retry"; className?: string }) {
  const { t } = useTranslation();
  const request = useUnit(takeRequested);
  return (
    <Button size="sm" className={className} onClick={() => request(id)}>
      {t(variant === "new" ? "queue.takeButton" : "queue.retryButton")}
    </Button>
  );
}
