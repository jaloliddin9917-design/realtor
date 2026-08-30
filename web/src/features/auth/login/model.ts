import { createEvent, createStore, sample } from "effector";
import { loginFx } from "@/entities/session";
import { isApiProblem } from "@/shared/api";
import { problemKey } from "@/shared/i18n";

export const submitted = createEvent<{ phone: string; password: string }>();
export const $loginError = createStore<string | null>(null)
  .on(loginFx.failData, (_, e) => (isApiProblem(e) ? problemKey(e.code) : "errors.network"))
  .reset(submitted, loginFx.done);
export const $pending = loginFx.pending;
sample({ clock: submitted, target: loginFx });
