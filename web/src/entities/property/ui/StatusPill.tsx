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
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold leading-none", STYLES[status], className)}>
      {t(statusKey(status))}
    </span>
  );
}
