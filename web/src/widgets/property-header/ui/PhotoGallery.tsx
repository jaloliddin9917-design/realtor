import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib";

/**
 * The property photos, OLX-style: a big main photo with prev/next arrows and a position
 * counter, a thumbnail strip below it to pick which photo shows there, and — clicking the main
 * photo — a full lightbox over ALL photos (its own prev/next, counter and thumbnail row; ←/→
 * keyboard nav; Esc closes, via the Dialog). The favourite heart is decorative: the app has no
 * favourites concept, so it carries no state and no click handler.
 */
export function PhotoGallery({ photos, alt }: { photos: { url: string }[]; alt: string }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const count = photos.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setIndex((i) => (i - 1 + count) % count);
      else if (e.key === "ArrowRight") setIndex((i) => (i + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count]);

  const current = photos[index];
  if (!current) {
    return (
      <div className="flex h-24 items-center justify-center rounded-card border border-line bg-surface text-xs text-muted-foreground">
        {t("property.noPhotos")}
      </div>
    );
  }
  const step = (d: number) => setIndex((i) => (i + d + count) % count);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="relative">
        <button type="button" onClick={() => setOpen(true)} aria-label={t("property.openGallery")} className="block w-full">
          <img src={current.url} alt={alt} className="aspect-[4/3] max-h-[85vh] w-full cursor-zoom-in object-cover" />
        </button>
        <div aria-hidden="true" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-surface/90 shadow-sm">
          <Heart className="size-[18px] text-ink" />
        </div>
        {count > 1 && (
          <>
            <button type="button" aria-label={t("property.prevPhoto")} onClick={() => step(-1)} className="absolute left-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 shadow-sm hover:bg-surface">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" aria-label={t("property.nextPhoto")} onClick={() => step(1)} className="absolute right-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-surface/90 shadow-sm hover:bg-surface">
              <ChevronRight className="size-5" />
            </button>
            <span className="num absolute bottom-3 right-3 rounded-full bg-ink/70 px-3 py-1 text-xs font-semibold text-white">{index + 1} / {count}</span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="flex gap-1.5 overflow-x-auto p-2.5">
          {photos.map((p, i) => (
            <button
              key={p.url}
              type="button"
              aria-label={`${alt} ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn("h-[58px] w-[78px] flex-none overflow-hidden rounded-md", i === index ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100")}
            >
              <img src={p.url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { if (!o) setOpen(false); }}>
        <DialogContent className="max-w-6xl gap-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {open && (
            <div className="flex flex-col gap-3">
              <div className="relative flex items-center justify-center">
                <img src={photos[index]?.url} alt="" className="max-h-[86vh] w-full rounded-lg object-contain" />
                {count > 1 && (
                  <>
                    <button type="button" aria-label={t("property.prevPhoto")} onClick={() => step(-1)} className="absolute left-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
                      <ChevronLeft className="size-5" />
                    </button>
                    <button type="button" aria-label={t("property.nextPhoto")} onClick={() => step(1)} className="absolute right-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
                      <ChevronRight className="size-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="num text-center text-sm text-muted-foreground">{index + 1} / {count}</div>
              {count > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {photos.map((p, i) => (
                    <button key={p.url} type="button" aria-label={`${alt} ${i + 1}`} onClick={() => setIndex(i)} className={cn("size-14 flex-none overflow-hidden rounded-md", i === index ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100")}>
                      <img src={p.url} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
