import { useState } from "react";
import { useUnit } from "effector-react";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { $urlError, addUrlFx, addUrlRequested, dialogClosed } from "./model";

export function AddManualDialog() {
  const { t } = useTranslation();
  const [request, close, pending, error] = useUnit([addUrlRequested, dialogClosed, addUrlFx.pending, $urlError]);
  const [url, setUrl] = useState("");
  return (
    <Dialog onOpenChange={(o) => { if (!o) { close(); setUrl(""); } }}>
      <DialogTrigger asChild><Button variant="secondary" size="sm"><Plus className="size-4" />{t("properties.addManual")}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("manual.title")}</DialogTitle></DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); request(url.trim()); }}>
          <div className="flex flex-col gap-1.5"><Label htmlFor="url">{t("manual.url")}</Label><Input id="url" type="url" placeholder={t("manual.urlPlaceholder")} value={url} onChange={(e) => setUrl(e.target.value)} required aria-invalid={!!error} /></div>
          {error && <p role="alert" className="rounded-md bg-status-inactive-bg px-3 py-2 text-sm text-status-inactive">{t(error)}</p>}
          <Button type="submit" disabled={pending}>{t("manual.submit")}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
