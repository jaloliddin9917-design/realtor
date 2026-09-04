import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib";

/**
 * The property photos: a preview grid (big first photo, the second, and a "+N" tile) that opens
 * a lightbox over ALL photos. Before this, the "+N" tile was a dead label — there was no way to
 * see photos past the first two. Clicking any tile opens the viewer at that photo; the viewer has
 * prev/next, a position counter, a thumbnail strip and ←/→ keyboard navigation (Esc closes, via
 * the Dialog).
 */
export function PhotoGallery({ photos, alt }: { photos: { url: string }[]; alt: string }) {
  const { t } = useTranslation();
  const [at, setAt] = useState<number | null>(null);
  const open = at !== null;
  const count = photos.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setAt((i) => (i === null ? i : (i - 1 + count) % count));
      else if (e.key === "ArrowRight") setAt((i) => (i === null ? i : (i + 1) % count));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count]);

  const [first, second, ...rest] = photos;
  if (!first) {
    return (
      <div className="flex h-24 items-center justify-center rounded-lg bg-[#d8e2df] text-xs text-[#6b7c77]">
        {t("property.noPhotos")}
      </div>
    );
  }
  const step = (d: number) => setAt((i) => (i === null ? i : (i + d + count) % count));

  return (
    <>
      <div className="grid grid-cols-[2fr_1fr] grid-rows-[96px_96px] gap-1.5 lg:grid-rows-[160px_160px]">
        <button type="button" onClick={() => setAt(0)} className="row-span-2 overflow-hidden rounded-lg" aria-label={t("property.openGallery")}>
          <img src={first.url} alt={alt} className="size-full object-cover" />
        </button>
        {second ? (
          <button type="button" onClick={() => setAt(1)} className="overflow-hidden rounded-lg" aria-label={t("property.openGallery")}>
            <img src={second.url} alt="" className="size-full object-cover" />
          </button>
        ) : (
          <div className="rounded-lg bg-[#d8e2df]" />
        )}
        <button
          type="button"
          onClick={() => setAt(rest.length > 0 ? 2 : 0)}
          className="flex items-center justify-center rounded-lg bg-[#d8e2df] text-sm font-semibold text-[#3f4d49] hover:bg-[#cdd9d4]"
        >
          {rest.length > 0 ? `+${rest.length}` : t("property.photos", { count })}
        </button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setAt(null); }}>
        <DialogContent className="max-w-4xl gap-2">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {open && (
            <div className="flex flex-col gap-3">
              <div className="relative flex items-center justify-center">
                <img src={photos[at]?.url} alt="" className="max-h-[70vh] w-full rounded-lg object-contain" />
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
              <div className="num text-center text-sm text-muted-foreground">{at + 1} / {count}</div>
              {count > 1 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {photos.map((p, i) => (
                    <button key={p.url} type="button" onClick={() => setAt(i)} className={cn("size-14 flex-none overflow-hidden rounded-md", i === at ? "ring-2 ring-primary" : "opacity-60 hover:opacity-100")}>
                      <img src={p.url} alt="" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
