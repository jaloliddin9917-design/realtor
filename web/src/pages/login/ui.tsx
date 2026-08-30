import { useTranslation } from "react-i18next";
import { LoginForm } from "@/features/auth/login";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { APP_NAME } from "@/shared/config";

export function LoginPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between"><div><div className="text-lg font-bold">{APP_NAME}</div><div className="text-xs text-muted-foreground">{t("app.tagline")}</div></div><LanguageSwitch /></div>
        <h1 className="mb-4 text-xl font-semibold">{t("auth.title")}</h1>
        <LoginForm />
      </div>
    </div>
  );
}
