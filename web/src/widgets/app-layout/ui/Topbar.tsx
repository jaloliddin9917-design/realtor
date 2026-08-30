export function Topbar({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <header className="flex h-14 flex-none items-center gap-4 border-b border-line bg-surface px-4 lg:px-6">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <div className="flex-1" />
      {actions}
    </header>
  );
}
