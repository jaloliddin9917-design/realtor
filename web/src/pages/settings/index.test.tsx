import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { $users, fetchUsersFx, MOCK_SETTINGS } from "@/entities/setting";
import { $sources, fetchSourcesFx, type Source } from "@/entities/source";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { SettingsPage } from "./index";

const admin: User = { id: "u1", phone: "+998900000001", name: "Sardor", role: "admin", locale: "uz" };

// The one real source today (see entities/source) — kept minimal since SourcesSection's line
// only reads name/kind/enabled/status/last_run.
const olxRent: Source = {
  id: "s1", kind: "olx", name: "olx-rent", enabled: true, interval_seconds: 900, status: "ok",
  last_run_at: null, next_run_at: null, paused_until: null, consecutive_failures: 0, config: {}, last_run: null,
};

async function mount() {
  const scope = fork({
    values: [[$users, MOCK_SETTINGS.users], [$sources, [olxRent]]],
    handlers: [
      [fetchUsersFx, async () => MOCK_SETTINGS.users],
      [fetchSourcesFx, async () => ({ items: [olxRent], fx: null })],
    ],
  });
  await allSettled(sessionRestored, { scope, params: admin });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/settings"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><SettingsPage /></RouterProvider>
    </Provider>,
  );
}

describe("SettingsPage", () => {
  beforeAll(() => i18nReady);

  it("shows the users table, the sources and channel overviews, and the rules form", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Sozlamalar" })).toBeInTheDocument();
    // the users table (Sardor is the admin from the mockup, seeded straight into $users) —
    // scoped to a table cell since the signed-in Sardor's name also appears in the sidebar
    expect(screen.getByRole("cell", { name: "Sardor" })).toBeInTheDocument();
    // honest active/inactive (no bot/presence backend) — 4 of the 5 mock users are active, Dilshod isn't
    expect(screen.getAllByText("faol")).toHaveLength(4);
    expect(screen.getByText("nofaol")).toBeInTheDocument();
    // the Manbalar and Bot kanallari overviews
    expect(screen.getByText(/olx-rent/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram — jamoa akkaunti/)).toBeInTheDocument();
    // a rule's default value, editable in the form
    expect(screen.getByLabelText("Qulf muddati (olingan uy)")).toHaveValue(4);
    expect(screen.getByRole("button", { name: "Saqlash" })).toBeInTheDocument();
  });

  it("renders the add-user dialog trigger", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Qo'shish" })).toBeInTheDocument();
  });
});
