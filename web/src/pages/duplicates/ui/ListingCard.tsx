import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DuplicateListingSide } from "@/entities/duplicate";
import { classificationKey } from "@/shared/i18n";
import { cn, formatPhone, formatUsdFromMinor } from "@/shared/lib";

export function ListingCard({ label, listing }: { label: "A" | "B"; listing: DuplicateListingSide }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label} · {listing.sourceLabel}</span>
        <span className="text-xs text-muted-foreground">{listing.postedLabel} · {t("duplicates.pair.daysAgo", { days: listing.daysAgo })}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {listing.photoMatches.map((m) => (
          <div key={m.n} className="flex flex-col items-center justify-center gap-1 rounded-lg bg-surface-soft p-2 text-center">
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-primary">{t("duplicates.photo.matchBadge", { match: m.match })}</span>
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-[11px] text-muted-foreground">{t("duplicates.photo.label", { n: m.n })}</span>
          </div>
        ))}
        {listing.extraPhotos > 0 && (
          <div className="flex flex-col items-center justify-center gap-1 rounded-lg bg-surface-soft p-2 text-center">
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
            <span className="text-[11px] text-muted-foreground">{t("duplicates.photo.more", { count: listing.extraPhotos })}</span>
          </div>
        )}
      </div>
      <div className="text-sm font-medium">{listing.title}</div>
      <div className="text-sm">
        <span className="num font-semibold">{formatUsdFromMinor(listing.priceUsdMinor)}</span> · {t("properties.rooms", { count: listing.rooms })} · {listing.floor}/{listing.totalFloors} · {t("properties.area", { area: listing.areaSqm })}
      </div>
      <p className="text-xs text-muted-foreground">{listing.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2.5">
        <span className="num font-mono text-sm">{formatPhone(listing.phone)}</span>
        <span className={cn("inline-flex h-5 w-fit items-center rounded-full px-2 text-xs font-semibold", listing.classification === "owner" ? "bg-owner-bg text-owner" : "bg-agent-bg text-agent")}>
          {t(classificationKey(listing.classification))} · {t("duplicates.contact.homesCount", { count: listing.homesCount })}
        </span>
      </div>
    </div>
  );
}
