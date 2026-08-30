import { useTranslation } from "react-i18next";
import { ListingRow, type Listing } from "@/entities/listing";
import type { PropertyDetail } from "@/entities/property";

export function ListingsList({ listings, duplicates }: { listings: Listing[]; duplicates: PropertyDetail["duplicates"] }) {
  const { t } = useTranslation();
  const closest = duplicates[0];
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("property.listings")} · {listings.length}</span>
      {listings.map((l) => <ListingRow key={l.id} listing={l} />)}
      {closest && (
        // a note, not an action: merging duplicates is out of scope, the agent just needs to know
        <div className="flex gap-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2 text-[13px] text-warn">
          <b>{t("property.duplicate")}:</b> {t("property.duplicateOf", { score: closest.score.toFixed(2) })}
        </div>
      )}
    </div>
  );
}
