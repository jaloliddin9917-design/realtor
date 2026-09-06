import { cn } from "@/shared/lib";

/** A dashboard summary tile: a semantic accent dot + label, a big tabular figure, and an
 * optional sub-line plus a breakdown footer (a mini-bar or chips). Composed the same way for
 * all four tiles so their edges, baselines and spacing line up. */
export function Tile({ accent, label, value, sub, foot }: {
  accent: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  foot?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 flex-none rounded-full", accent)} aria-hidden />
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className="num text-[32px] font-extrabold leading-none tracking-tight text-ink">{value}</div>
      {sub != null && <div className="-mt-1 text-xs text-muted-foreground">{sub}</div>}
      {foot}
    </div>
  );
}

/** A thin multi-segment progress bar for a tile footer; widths are percentages. */
export function TileBar({ segments }: { segments: { pct: number; className: string }[] }) {
  return (
    <div className="flex h-[7px] overflow-hidden rounded-full bg-surface-soft" aria-hidden>
      {segments.map((s, i) => <div key={i} className={s.className} style={{ width: `${s.pct}%` }} />)}
    </div>
  );
}
