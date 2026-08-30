import { useTranslation } from "react-i18next";
import { statusKey } from "@/shared/i18n";
import { cn } from "@/shared/lib";
import type { PropertyStatus } from "../api";

const STYLES: Record<PropertyStatus, string> = {
  new: "bg-status-new-bg text-status-new",
  active: "bg-status-active-bg text-status-active",
  inactive: "bg-status-inactive-bg text-status-inactive",
};

export function StatusPill({ status, className }: { status: PropertyStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold", STYLES[status], className)}>
      <span className="size-[7px] rounded-full bg-current" />{t(statusKey(status))}
    </span>
  );
}
