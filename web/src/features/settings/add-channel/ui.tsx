import { useEffect, useState } from "react";
import { useUnit } from "effector-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { $added, addChannelFx, addRequested, dialogClosed } from "./model";

export function AddChannelDialog() {
  const { t } = useTranslation();
  const [request, close, pending, added] = useUnit([addRequested, dialogClosed, addChannelFx.pending, $added]);
  const [open, setOpen] = useState(false);
  const [peer, setPeer] = useState("");
  useEffect(() => { if (added) { setOpen(false); setPeer(""); } }, [added]);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) close(); }}>
      <DialogTrigger asChild><Button variant="secondary" size="sm">{t("sources.add")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("sources.add")}</DialogTitle></DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); request(peer.trim()); }}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="channel-peer">{t("sources.peer")}</Label><Input id="channel-peer" value={peer} onChange={(e) => setPeer(e.target.value)} required minLength={2} /></div>
          <Button type="submit" disabled={pending}>{t("app.save")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
