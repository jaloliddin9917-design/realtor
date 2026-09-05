import { useTranslation } from "react-i18next";
import type { Schemas } from "@/shared/api";
import { classificationKey } from "@/shared/i18n";
import { cn, formatPhone } from "@/shared/lib";

type Owner = Schemas["OwnerOut"];

const STYLES: Record<Owner["classification"], string> = {
  owner: "bg-owner-bg text-owner",
  agent: "bg-agent-bg text-agent",
  unknown: "bg-status-new-bg text-status-new",
};

export function OwnerBadge({ owner }: { owner: Owner | null }) {
  const { t } = useTranslation();
  if (!owner) return <span className="text-muted-foreground">—</span>;
  const label = owner.confidence !== null && owner.classification === "owner"
    ? `${t(classificationKey("owner"))} · ${owner.confidence.toFixed(1)}`
    : t(classificationKey(owner.classification));
  return (
    <div className="flex flex-col gap-1">
      <span className="num font-mono whitespace-nowrap">{formatPhone(owner.identifier)}</span>
      <span className={cn("inline-flex w-fit items-center rounded-md px-2 py-0.5 text-[11px] font-bold leading-none", STYLES[owner.classification])}>{label}</span>
    </div>
  );
}
