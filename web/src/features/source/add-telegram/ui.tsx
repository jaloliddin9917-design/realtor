import { useEffect, useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { $addError, $added, $peerError, addFx, addRequested, dialogClosed } from "./model";

export function AddTelegramDialog() {
  const { t } = useTranslation();
  const [request, close, pending, peerError, addError, added] = useUnit([addRequested, dialogClosed, addFx.pending, $peerError, $addError, $added]);
  const [open, setOpen] = useState(false);
  const [peer, setPeer] = useState(""); const [name, setName] = useState(""); const [interval, setInterval] = useState("900");
  useEffect(() => { if (added) { setOpen(false); setPeer(""); setName(""); } }, [added]);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) close(); }}>
      <DialogTrigger asChild><Button variant="secondary" size="sm">{t("sources.add")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("sources.add")}</DialogTitle></DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); request({ peer: peer.trim(), name: name.trim() || null, interval_seconds: Number(interval) || 900 }); }}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="peer">{t("sources.peer")}</Label><Input id="peer" value={peer} onChange={(e) => setPeer(e.target.value)} required minLength={2} aria-invalid={!!peerError} />{peerError && <p role="alert" className="text-xs text-status-inactive">{t(peerError)}</p>}</div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="name">{t("sources.name")}</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label htmlFor="interval">{t("sources.interval")}</Label><Input id="interval" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} /></div>
          {addError && <p role="alert" className="rounded-md bg-status-inactive-bg px-3 py-2 text-sm text-status-inactive">{t(addError)}</p>}
          <Button type="submit" disabled={pending}>{t("app.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
