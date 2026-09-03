import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import type { PropertyDetail } from "@/entities/property";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { $note, noteChanged, setStatusFx, statusRequested } from "./model";

export function StatusButtons({ property }: { property: Pick<PropertyDetail, "id" | "status"> }) {
  const { t } = useTranslation();
  const [note, changeNote, request, pending] = useUnit([$note, noteChanged, statusRequested, setStatusFx.pending]);
  const send = (status: "active" | "inactive") => {
    request({ id: property.id, status, note: note.trim() || undefined });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" disabled={pending || property.status === "active"} onClick={() => send("active")}>{t("property.setActive")}</Button>
        <Button size="lg" variant="secondary" disabled={pending || property.status === "inactive"} onClick={() => send("inactive")}>{t("property.setInactive")}</Button>
      </div>
      <Input placeholder={t("property.notePlaceholder")} aria-label={t("property.note")} value={note} onChange={(e) => changeNote(e.target.value)} maxLength={500} />
    </div>
  );
}
