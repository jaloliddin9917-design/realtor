import { Card, CardContent, CardDescription, CardHeader } from "@/shared/ui/card";

export function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="gap-1 px-4">
        <CardDescription className="text-[11px] font-semibold uppercase tracking-wider">{label}</CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        <div className="flex items-baseline text-3xl font-bold leading-none">{value}</div>
        <div className="mt-1.5 text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}
