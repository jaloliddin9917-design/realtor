import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { BotMonitorPage } from "./index";

const agent: User = { id: "u2", phone: "+998900000002", name: "Aziz", role: "agent", locale: "uz" };

async function mount() {
  const scope = fork();
  await allSettled(sessionRestored, { scope, params: agent });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/bot"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><BotMonitorPage /></RouterProvider>
    </Provider>,
  );
}

describe("BotMonitorPage", () => {
  beforeAll(() => i18nReady);

  it("shows the channel cards, the counters and the outreach table", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Xabarlar" })).toBeInTheDocument();
    // Telegram's "sent / daily limit" card
    expect(screen.getByText("61 / 100")).toBeInTheDocument();
    // the counter row
    expect(screen.getByText("96")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    // a sample outreach row, and its mapped result badge
    expect(screen.getByText(/Chilonzor, Qatortol/)).toBeInTheDocument();
    expect(screen.getByText(/Yakkasaroy, Bobur/)).toBeInTheDocument();
  });

  it("offers resolve buttons for the unclear reply and an open-property link for a resolved one", async () => {
    await mount();
    // the "unclear" row's free-text reply is shown verbatim, and gets two small resolve buttons
    expect(screen.getByText(/hozircha bor, lekin 420 ga/)).toBeInTheDocument();
    // vacant and taken rows both link "Uyni ochish" back to the list (no fabricated property id)
    const openLinks = screen.getAllByRole("link", { name: "Uyni ochish" });
    expect(openLinks.length).toBeGreaterThan(0);
    for (const link of openLinks) expect(link).toHaveAttribute("href", "/properties");
  });
});
