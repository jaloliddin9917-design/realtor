import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { i18nReady } from "@/shared/i18n";
import { $fx, $sources, type Source } from "@/entities/source";
import { router } from "@/shared/router";
import { AdminSourcesPage } from "./index";

const src = { id: "s1", kind: "olx", name: "olx-tashkent", enabled: true, interval_seconds: 900, status: "failing", last_run_at: "2026-08-29T12:00:00Z", next_run_at: "2026-08-29T12:15:00Z", paused_until: null, consecutive_failures: 2, config: { url: "https://www.olx.uz/x/" }, last_run: { id: "r1", started_at: "2026-08-29T12:00:00Z", finished_at: "2026-08-29T12:01:00Z", found: 52, new: 3, changed: 1, failed: 0, removed: 0, error: "boom" } } as Source;

describe("AdminSourcesPage", () => {
  beforeAll(() => i18nReady);
  it("shows the table, the failing status, the last error and the stale FX banner", () => {
    // AppLayout's Sidebar renders atomic-router-react <Link>s, which need a RouterProvider
    // ancestor (see widgets/app-layout/ui/AppLayout.test.tsx for the same wrapping).
    render(
      <Provider value={fork({ values: [[$sources, [src]], [$fx, { date: "2026-08-15", usd_uzs: "12500.00", fetched_at: "2026-08-15T03:00:00Z", stale: true }]] })}>
        <RouterProvider router={router}><AdminSourcesPage /></RouterProvider>
      </Provider>,
    );
    expect(screen.getByText("olx-tashkent")).toBeInTheDocument();
    expect(screen.getByText("Xato")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByText(/Valyuta kursi/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kanal qo'shish" })).toBeInTheDocument();
  });
});
