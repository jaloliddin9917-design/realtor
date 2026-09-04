import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { $channels, $counters, $rows, fetchBotFx, MOCK_BOT_OVERVIEW, type BotOverview } from "@/entities/bot";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { BotMonitorPage } from "./index";

const agent: User = { id: "u2", phone: "+998900000002", name: "Aziz", role: "agent", locale: "uz" };

/** Sending is off this milestone (see entities/bot/api.ts's module docstring): the real
 * GET /bot response today is exactly this shape — two present-but-not_configured channels
 * with their real send limits, all-zero counters, and no items. Not a fabricated shape. */
const NOTHING_SENT_YET: BotOverview = {
  channels: [
    { channel: "telegram", enabled: false, status: "not_configured", sentToday: 0, perHour: 12, perDay: 100 },
    { channel: "sms", enabled: false, status: "not_configured", sentToday: 0, perHour: null, perDay: 100 },
  ],
  counters: { today: 0, queued: 0, replied: 0, unclear: 0, errors: 0 },
  rows: [],
};

async function mount(overview: BotOverview) {
  // All three stores start empty (see entities/bot) and are normally filled by the
  // botMonitor.opened wiring in app/router.ts — seeded here the same way pages/dashboard's test
  // seeds its stores, with a `fetchBotFx` handler as a safety net.
  const scope = fork({
    values: [[$channels, overview.channels], [$counters, overview.counters], [$rows, overview.rows]],
    handlers: [[fetchBotFx, async () => overview]],
  });
  await allSettled(sessionRestored, { scope, params: agent });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/bot"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><BotMonitorPage /></RouterProvider>
    </Provider>,
  );
  return scope;
}

describe("BotMonitorPage", () => {
  beforeAll(() => i18nReady);

  it("shows the channel cards, the counters and the outreach table", async () => {
    await mount(MOCK_BOT_OVERVIEW);
    expect(screen.getByRole("heading", { name: "Xabarlar" })).toBeInTheDocument();
    // Telegram's "sent / daily limit" card
    expect(screen.getByText("61 / 100")).toBeInTheDocument();
    // the counter row
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    // a sample outreach row (district only now — no street/agent, see entities/bot/api.ts)
    expect(screen.getByText(/Chilonzor/)).toBeInTheDocument();
    expect(screen.getByText(/Yakkasaroy/)).toBeInTheDocument();
  });

  it("offers resolve buttons for the unclear reply and an open-property link for a resolved one", async () => {
    await mount(MOCK_BOT_OVERVIEW);
    // the "unclear" row's free-text reply is shown verbatim, and gets two small resolve buttons
    expect(screen.getByText(/hozircha bor, lekin 420 ga/)).toBeInTheDocument();
    // vacant and taken rows both link "Uyni ochish" back to the list (no fabricated property id)
    const openLinks = screen.getAllByRole("link", { name: "Uyni ochish" });
    expect(openLinks.length).toBeGreaterThan(0);
    for (const link of openLinks) expect(link).toHaveAttribute("href", "/properties");
  });

  it("shows the honest not-yet-configured empty state when nothing has been sent", async () => {
    await mount(NOTHING_SENT_YET);
    expect(screen.getByText("Xabar yuborish hali sozlanmagan")).toBeInTheDocument();
    // both channel cards read "not configured" — no fabricated activity or limits
    expect(screen.getAllByText("Sozlanmagan")).toHaveLength(2);
    expect(screen.queryByText(/Chilonzor/)).not.toBeInTheDocument();
  });
});
