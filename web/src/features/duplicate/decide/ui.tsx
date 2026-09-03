import { useUnit } from "effector-react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { decideFx, decisionRequested } from "./model";

export function DecisionButtons() {
  const { t } = useTranslation();
  const [decide, pending] = useUnit([decisionRequested, decideFx.pending]);
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="lg" disabled={pending} onClick={() => decide("merge")}>
        <Check className="size-4" />{t("duplicates.decision.merge")}
      </Button>
      <Button size="lg" variant="outline" disabled={pending} onClick={() => decide("different")}>
        <X className="size-4" />{t("duplicates.decision.different")}
      </Button>
    </div>
  );
}
