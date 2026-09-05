import { useTranslation } from "react-i18next";
import { ListingRow, type Listing } from "@/entities/listing";
import type { PropertyDetail } from "@/entities/property";
import { classificationKey } from "@/shared/i18n";
import { formatUsdFromMinor } from "@/shared/lib";

export function ListingsList({ listings, duplicates }: { listings: Listing[]; duplicates: PropertyDetail["duplicates"] }) {
  const { t } = useTranslation();
  const closest = duplicates[0];
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.listings")} · {listings.length}</span>
      {listings.map((l) => (
        <div key={l.id} className="flex flex-col gap-1">
          <ListingRow listing={l} />
          {/* Supplements ListingRow (kind, date, original-currency price, source link) with the
              rich-apartments fields: a converted USD price (skipped when already USD-priced —
              showing the same figure twice is just noise), an owner/agent marker, and the
              listing's own approximate location. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-xs text-muted-foreground">
            {l.price.currency !== "USD" && l.price.usd_minor != null && (
              <span className="num">≈ {formatUsdFromMinor(l.price.usd_minor)}</span>
            )}
            {l.owner_marker && (
              <span className="inline-flex h-5 items-center rounded-full bg-owner-bg px-2 font-semibold text-owner">{t(classificationKey("owner"))}</span>
            )}
            {l.agent_marker && (
              <span className="inline-flex h-5 items-center rounded-full bg-agent-bg px-2 font-semibold text-agent">{t(classificationKey("agent"))}</span>
            )}
            {l.location_label && <span className="truncate">{l.location_label}</span>}
          </div>
        </div>
      ))}
      {closest && (
        // a note, not an action: merging duplicates is out of scope, the agent just needs to know
        <div className="flex gap-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-warn">
          <b>{t("property.duplicate")}:</b> {t("property.duplicateOf", { score: closest.score.toFixed(2) })}
        </div>
      )}
    </div>
  );
}
