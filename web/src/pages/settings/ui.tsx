import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { Separator } from "@/shared/ui/separator";
import { AppLayout } from "@/widgets/app-layout";
import { ChannelsSection } from "./ui/ChannelsSection";
import { RulesSection } from "./ui/RulesSection";
import { SourcesSection } from "./ui/SourcesSection";
import { UsersSection } from "./ui/UsersSection";

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("nav.settings")} actions={<LanguageSwitch />}>
      <UsersSection />
      <Separator />
      <SourcesSection />
      <Separator />
      <ChannelsSection />
      <Separator />
      <RulesSection />
    </AppLayout>
  );
}
