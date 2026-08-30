import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Schemas } from "@/shared/api";
import { kindKey } from "@/shared/i18n";
import { cn, formatDate, formatMoney } from "@/shared/lib";

export type Listing = Schemas["ListingOut"];

export function ListingRow({ listing }: { listing: Listing }) {
  const { t, i18n } = useTranslation();
  return (
    <div className={cn("flex items-center gap-2 text-[13px]", listing.source_removed && "text-muted-foreground")}>
      <span className="rounded bg-bg px-2 py-0.5 text-xs font-medium text-[#3f4d49]">{t(kindKey(listing.source.kind))}</span>
      <span className="min-w-0 flex-1 truncate">
        {formatDate(listing.posted_at, i18n.language)} · {listing.source.name}
        {listing.source_removed && <> · <span>{t("property.sourceRemoved")}</span></>}
      </span>
      <span className="num font-semibold">{formatMoney(listing.price.amount_minor, listing.price.currency, i18n.language)}</span>
      {listing.url && <a href={listing.url} target="_blank" rel="noreferrer" aria-label={t("property.openSource")} className="text-muted-foreground hover:text-primary"><ExternalLink className="size-4" /></a>}
    </div>
  );
}
