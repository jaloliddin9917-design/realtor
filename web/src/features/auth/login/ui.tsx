import { useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { $loginError, $pending, submitted } from "./model";

export function LoginForm() {
  const { t } = useTranslation();
  const [error, pending, submit] = useUnit([$loginError, $pending, submitted]);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit({ phone, password }); }}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">{t("auth.phone")}</Label>
        <Input id="phone" name="phone" inputMode="tel" autoComplete="username" placeholder={t("auth.phonePlaceholder")} value={phone} onChange={(e) => setPhone(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      {error && <p role="alert" className="rounded-md bg-status-inactive-bg px-3 py-2 text-sm text-status-inactive">{t(error)}</p>}
      <Button type="submit" disabled={pending}>{t("auth.submit")}</Button>
    </form>
  );
}
