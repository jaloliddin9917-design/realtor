import { useTranslation } from "react-i18next";
import type { Schemas } from "@/shared/api";
import { classificationKey } from "@/shared/i18n";
import { cn, formatPhone } from "@/shared/lib";

export type Contact = Schemas["ContactOut"];

const STYLES: Record<Contact["classification"], string> = {
  owner: "bg-owner-bg text-owner",
  agent: "bg-agent-bg text-agent",
  unknown: "bg-status-new-bg text-status-new",
};

export function ContactRow({ contact }: { contact: Contact }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      {/* a telegram username is not a phone number; formatPhone returns it unchanged */}
      <span className="num font-mono">{formatPhone(contact.identifier)}</span>
      <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold", STYLES[contact.classification])}>{t(classificationKey(contact.classification))}</span>
    </div>
  );
}
