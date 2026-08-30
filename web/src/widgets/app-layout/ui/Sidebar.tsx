import { Link } from "atomic-router-react";
import { useUnit } from "effector-react";
import { Building2, LogOut, Sliders } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $isAdmin, $user, logout } from "@/entities/session";
import { routes } from "@/shared/router";
import { cn } from "@/shared/lib";
import { APP_NAME } from "@/shared/config";

export function Sidebar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const [user, isAdmin, doLogout] = useUnit([$user, $isAdmin, logout]);
  const [propertiesOpen, sourcesOpen] = useUnit([routes.properties.$isOpened, routes.adminSources.$isOpened]);
  const item = "flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-sidebar-ink hover:bg-white/10";
  return (
    <nav className={cn("flex w-56 flex-none flex-col gap-1 bg-sidebar p-3 text-sidebar-ink", className)} aria-label="main">
      <div className="flex items-center gap-2.5 px-2.5 pb-4 pt-1.5">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-white"><Building2 className="size-4" /></div>
        <div><div className="text-[15px] font-bold text-white">{APP_NAME}</div><div className="text-[11px] text-[#8fa39d]">{t("app.tagline")}</div></div>
      </div>
      <Link to={routes.properties} className={cn(item, propertiesOpen && "bg-white/10 text-white")}><Building2 className="size-5" />{t("nav.properties")}</Link>
      {isAdmin && <Link to={routes.adminSources} className={cn(item, sourcesOpen && "bg-white/10 text-white")}><Sliders className="size-5" />{t("nav.sources")}</Link>}
      <div className="flex-1" />
      {user && (
        <div className="flex items-center gap-2.5 rounded-lg bg-white/[.06] p-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{user.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-white">{user.name}</div><div className="text-[11px] text-[#8fa39d]">{t(`nav.role.${user.role}`)}</div></div>
          <button type="button" onClick={() => doLogout()} aria-label={t("nav.logout")} className="text-sidebar-ink hover:text-white"><LogOut className="size-4" /></button>
        </div>
      )}
    </nav>
  );
}
