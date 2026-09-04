import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { $channels, fetchBotFx, MOCK_BOT_OVERVIEW } from "@/entities/bot";
import { $meta, loadMetaFx, type Meta } from "@/entities/meta";
import { sessionRestored, type User } from "@/entities/session";
import { $users, fetchUsersFx, MOCK_USERS } from "@/entities/setting";
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

// The real GET /meta shape, with an honest rules snapshot (see backend RulesOut) — no quiet
// hours or per-contact caps, because the backend enforces neither.
const META: Meta = {
  districts: [], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"],
  fx: null,
  rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: 12, telegram_per_day: 100, sms_per_day: 100 },
};

async function mount() {
  const scope = fork({
    values: [[$users, MOCK_USERS], [$sources, [olxRent]], [$channels, MOCK_BOT_OVERVIEW.channels], [$meta, META]],
    handlers: [
      [fetchUsersFx, async () => MOCK_USERS],
      [fetchSourcesFx, async () => ({ items: [olxRent], fx: null })],
      [fetchBotFx, async () => MOCK_BOT_OVERVIEW],
      [loadMetaFx, async () => META],
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

  it("shows the users table, the sources and channel overviews, and the read-only rules", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Sozlamalar" })).toBeInTheDocument();
    // the users table (Sardor is the admin from the mockup, seeded straight into $users) —
    // scoped to a table cell since the signed-in Sardor's name also appears in the sidebar
    expect(screen.getByRole("cell", { name: "Sardor" })).toBeInTheDocument();
    // honest active/inactive (no bot/presence backend) — 4 of the 5 mock users are active, Dilshod isn't
    expect(screen.getAllByText("faol")).toHaveLength(4);
    expect(screen.getByText("nofaol")).toBeInTheDocument();
    // the Manbalar overview (real $sources) and Bot kanallari overview (real $channels, from
    // entities/bot — same store the Bot Monitor screen renders)
    expect(screen.getByText(/olx-rent/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram — Sozlanmagan/)).toBeInTheDocument();
    expect(screen.getByText(/SMS — Sozlanmagan/)).toBeInTheDocument();
    // the rules section reads $meta.rules — real values, displayed read-only
    expect(screen.getByText("4 soat")).toBeInTheDocument();
    expect(screen.getByText("≥ 0.75")).toBeInTheDocument();
    // no editable inputs and no Save button — there is no rules-persistence endpoint
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saqlash" })).not.toBeInTheDocument();
  });

  it("renders the add-user dialog trigger", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Qo'shish" })).toBeInTheDocument();
  });

  it("does not offer an add-channel dialog — real channel adding lives on /admin/sources", async () => {
    await mount();
    expect(screen.queryByRole("button", { name: "Kanal qo'shish" })).not.toBeInTheDocument();
  });
});
