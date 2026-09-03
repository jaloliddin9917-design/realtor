import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/features/i18n/switch-language";
import { AppLayout } from "@/widgets/app-layout";
import { ChannelCards } from "./ui/ChannelCards";
import { CountersBar } from "./ui/CountersBar";
import { OutreachTable } from "./ui/OutreachTable";

export function BotMonitorPage() {
  const { t } = useTranslation();
  return (
    <AppLayout title={t("nav.bot")} actions={<LanguageSwitch />}>
      <ChannelCards />
      <CountersBar />
      <OutreachTable />
    </AppLayout>
  );
}
