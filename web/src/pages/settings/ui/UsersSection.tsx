import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { $users } from "@/entities/setting";
import { AddUserDialog } from "@/features/settings/add-user";
import { formatPhone } from "@/shared/lib";

const th = "whitespace-nowrap bg-surface-soft px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const td = "border-b border-line-soft px-3 py-2.5 align-middle";

export function UsersSection() {
  const { t } = useTranslation();
  const users = useUnit($users);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{t("settingsPage.users.title")}</h2>
        <AddUserDialog />
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>{t("settingsPage.users.columns.name")}</th>
              <th className={th}>{t("settingsPage.users.columns.role")}</th>
              <th className={th}>{t("settingsPage.users.columns.phone")}</th>
              <th className={th}>{t("settingsPage.users.columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={`${td} font-medium`}>{u.name}</td>
                <td className={td}>{t(`nav.role.${u.role}`)}</td>
                <td className={`${td} num`}>{formatPhone(u.phone)}</td>
                <td className={td}>{t(u.active ? "settingsPage.users.status.active" : "settingsPage.users.status.inactive")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t("settingsPage.users.footnote")}</p>
    </div>
  );
}
