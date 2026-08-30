import { useTranslation } from "react-i18next";
import { ContactRow, type Contact } from "@/entities/contact";
import type { PropertyDetail } from "@/entities/property";
import { formatPhone } from "@/shared/lib";

export function ContactsList({ detail }: { detail: PropertyDetail }) {
  const { t } = useTranslation();
  const owner = detail.probable_owner;
  // one number can appear on several listings of the same property; the owner has its own card
  const others: Contact[] = detail.listings
    .flatMap((l) => l.contacts)
    .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i && c.id !== owner?.contact_id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5 rounded-card border border-[#bcdcd6] bg-surface p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.owner")}</span>
          {owner?.confidence != null && <span className="rounded-full bg-owner-bg px-2.5 py-0.5 text-xs font-semibold text-owner">{t("property.confidence", { value: owner.confidence.toFixed(1) })}</span>}
        </div>
        {owner
          ? <a href={`tel:${owner.identifier}`} className="num font-mono text-lg font-semibold">{formatPhone(owner.identifier)}</a>
          : <span className="text-muted-foreground">{t("property.noOwner")}</span>}
      </div>
      <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.contacts")}</span>
        {others.length === 0
          ? <span className="text-xs text-muted-foreground">{t("property.noContacts")}</span>
          : others.map((c) => <ContactRow key={c.id} contact={c} />)}
      </div>
    </div>
  );
}
