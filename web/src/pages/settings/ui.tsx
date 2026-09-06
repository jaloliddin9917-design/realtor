import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $users, $usersPending } from "@/entities/setting";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { Separator } from "@/shared/ui/separator";
import { Skeleton } from "@/shared/ui/skeleton";
import { AppLayout } from "@/widgets/app-layout";
import { ChannelsSection } from "./ui/ChannelsSection";
import { RulesSection } from "./ui/RulesSection";
import { SourcesSection } from "./ui/SourcesSection";
import { UsersSection } from "./ui/UsersSection";

export function SettingsPage() {
  const { t } = useTranslation();
  const [pending, users] = useUnit([$usersPending, $users]);
  return (
    <AppLayout title={t("nav.settings")} actions={<LanguageSwitch />}>
      {pending && users.length === 0 ? (
        <>
          <Skeleton className="h-56 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </>
      ) : (
        <>
          <UsersSection />
          <Separator />
          <SourcesSection />
          <Separator />
          <ChannelsSection />
          <Separator />
          <RulesSection />
        </>
      )}
    </AppLayout>
  );
}
