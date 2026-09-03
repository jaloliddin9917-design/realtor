import { useEffect, useState } from "react";
import { useUnit } from "effector-react";
import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserRole } from "@/entities/setting";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { $added, addRequested, addUserFx, dialogClosed } from "./model";

const ROLES: UserRole[] = ["admin", "agent"];

export function AddUserDialog() {
  const { t } = useTranslation();
  const [request, close, pending, added] = useUnit([addRequested, dialogClosed, addUserFx.pending, $added]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<UserRole>("agent");
  useEffect(() => { if (added) { setOpen(false); setName(""); setPhone(""); setRole("agent"); } }, [added]);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) close(); }}>
      <DialogTrigger asChild><Button variant="secondary" size="sm"><UserPlus className="size-4" />{t("settingsPage.users.add")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("settingsPage.users.dialogTitle")}</DialogTitle></DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); request({ name: name.trim(), phone: phone.trim(), role }); }}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="user-name">{t("settingsPage.users.columns.name")}</Label><Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="user-phone">{t("settingsPage.users.columns.phone")}</Label><Input id="user-phone" type="tel" placeholder={t("auth.phonePlaceholder")} value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="user-role">{t("settingsPage.users.columns.role")}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger id="user-role" aria-label={t("settingsPage.users.columns.role")}><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{t(`nav.role.${r}`)}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>{t("app.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
