import { useState } from "react";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppLayout({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false); // local UI state only
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar className="hidden lg:flex" />
      {open && <div className="fixed inset-0 z-40 flex lg:hidden" onClick={() => setOpen(false)}><Sidebar className="h-full" /><div className="flex-1 bg-black/40" /></div>}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={title} actions={<>
          <button type="button" className="lg:hidden" aria-label={t("app.menu")} onClick={() => setOpen(true)}><Menu className="size-5" /></button>
          {actions}
        </>} />
        <section className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-6">{children}</section>
      </main>
    </div>
  );
}
