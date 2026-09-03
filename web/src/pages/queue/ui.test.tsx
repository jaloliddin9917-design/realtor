import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { $items, fetchQueueFx, MOCK_QUEUE } from "@/entities/queue";
import { QueuePage } from "./ui";

const agent: User = { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" };

async function mount() {
  const scope = fork({ values: [[$items, MOCK_QUEUE]], handlers: [[fetchQueueFx, async () => MOCK_QUEUE]] });
  await allSettled(sessionRestored, { scope, params: agent });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}>
        <QueuePage />
      </RouterProvider>
    </Provider>,
  );
  return scope;
}

describe("QueuePage", () => {
  beforeAll(() => i18nReady);

  it("shows the queue heading, the signed-in agent, a card per state and the tab counts", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Navbat" })).toBeInTheDocument(); // AppLayout's Topbar title (nav.queue)
    expect(screen.getByText("Navbatim")).toBeInTheDocument();
    // the date+agent line ("… · Aziz") — a plain /Aziz/ regex would also match the sidebar's
    // user badge and item 1046's unrelated activity note, both of which mention "Aziz" too
    expect(screen.getByText(/· Aziz$/)).toBeInTheDocument();

    // one card per non-retry state, using the screen spec's own worked examples — the default
    // "Bugun" tab excludes retry items (see the second test below for that state)
    expect(screen.getByText(/Chilonzor, Qatortol/)).toBeInTheDocument();
    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.getAllByText(/Siz olgansiz/)).toHaveLength(3); // three "mine" items seeded
    expect(screen.getByText(/Sergeli, 7-mavze/)).toBeInTheDocument();
    expect(screen.getByText(/Yunusobod, 4-kvartal/)).toBeInTheDocument();
    expect(screen.getByText(/Malika ishlamoqda/)).toBeInTheDocument();

    // 12 seeded items: 3 mine + 4 new + 2 locked = 9 "today"; 3 retry; 12 total
    expect(screen.getByRole("tab", { name: "Bugun · 9" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Qayta · 3" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Umumiy · 12" })).toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: /Olish va qo'ng'iroq qilish/ })).toHaveLength(4); // four "new" items seeded
  });

  it("the Qayta tab filters the list down to the retry example only", async () => {
    await mount();
    await userEvent.click(screen.getByRole("tab", { name: "Qayta · 3" }));

    expect(screen.getAllByRole("button", { name: /Qayta urinish/ })).toHaveLength(3);
    expect(screen.getByText(/Mirzo Ulug'bek, TTZ/)).toBeInTheDocument();
    // "Javob yo'q" appears both in a retry card's header and its note line, across three retry cards
    expect(screen.getAllByText(/Javob yo'q/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Siz olgansiz/)).not.toBeInTheDocument();
  });
});
