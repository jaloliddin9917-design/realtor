import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { $meta } from "@/entities/meta";
import { $page, type PropertyRow } from "@/entities/property";
import { sessionRestored } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertiesPage } from "./ui";

const row: PropertyRow = { id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false, first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"], probable_owner: null, photo_url: null, last_status_event: null };

async function mount() {
  const scope = fork({
    values: [
      [$page, { items: [row], total: 42, page: 1, page_size: 20 }],
      [$meta, { districts: ["chilonzor", "sergeli"], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"] }],
    ],
  });
  await allSettled(sessionRestored, { scope, params: { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" } });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
  render(<Provider value={scope}><RouterProvider router={router}><PropertiesPage /></RouterProvider></Provider>);
  return scope;
}

describe("PropertiesPage", () => {
  beforeAll(() => i18nReady);

  it("renders the filters, the results count and both renderings of the rows", async () => {
    await mount();
    // district chips come from /meta, not from a hardcoded list
    expect(screen.getByRole("button", { name: "Chilonzor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sergeli" })).toBeInTheDocument();
    expect(screen.getByText("42 ta uy")).toBeInTheDocument();
    // the table (≥ lg) and the cards (< lg) both render; CSS picks one
    expect(screen.getAllByRole("link", { name: /Chilonzor/ })).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Narx" })).toBeInTheDocument();
    // 42 rows over a page size of 20 → 3 pages, so the pager is shown
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("puts a chip click into the URL instead of component state", async () => {
    const scope = await mount();
    await userEvent.click(screen.getByRole("button", { name: "Sergeli" }));
    // the push to history is an effect, so give it a tick rather than assuming it is done
    await waitFor(() => expect(scope.getState(router.$query)).toEqual({ district: "sergeli" }));
    expect(screen.getByRole("button", { name: "Sergeli" })).toHaveAttribute("aria-pressed", "true");
  });
});
