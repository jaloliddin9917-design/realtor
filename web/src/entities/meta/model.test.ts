import { allSettled, fork } from "effector";
import { toast } from "sonner";
import { i18n } from "@/shared/i18n";
import { loadMetaFx } from "./model";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("meta load errors", () => {
  it("toasts a translated error when the meta request fails", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    await allSettled(loadMetaFx, { scope });
    expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.internal_error"));
  });
});
