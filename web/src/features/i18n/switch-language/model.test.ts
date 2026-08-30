import { allSettled, fork } from "effector";
import { i18n, i18nReady } from "@/shared/i18n";
import { LANG_STORAGE_KEY } from "@/shared/config";
import { $lang, languageChanged } from "./model";

describe("language switch", () => {
  it("changes i18next's language and persists it", async () => {
    await i18nReady;
    const scope = fork();
    await allSettled(languageChanged, { scope, params: "ru" });
    expect(scope.getState($lang)).toBe("ru");
    expect(i18n.language).toBe("ru");
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("ru");
    expect(i18n.t("nav.properties")).toBe("Квартиры");
    await allSettled(languageChanged, { scope, params: "uz" });
    expect(i18n.t("nav.properties")).toBe("Uylar");
  });
});
