import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import type { PropertyRow } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertyCardList } from "./PropertyCardList";

const row: PropertyRow = { id: "p2", status: "inactive", district: "yunusobod", rooms: 3, floor: 5, total_floors: 12, area_sqm: 72, price_usd_min_minor: 60000, source_removed: true, needs_recheck: false, first_seen_at: "2026-08-01T09:00:00Z", last_seen_at: "2026-08-28T10:00:00Z", listing_count: 1, source_kinds: ["telegram"], probable_owner: null, photo_url: null, last_status_event: null };

describe("PropertyCardList", () => {
  beforeAll(() => i18nReady);

  it("renders a card per row, linked to the property page", () => {
    render(<Provider value={fork()}><RouterProvider router={router}><PropertyCardList rows={[row]} /></RouterProvider></Provider>);
    expect(screen.getByText("Yunusobod")).toBeInTheDocument();
    expect(screen.getByText("3-xonali · 5/12 qavat · 72 m²")).toBeInTheDocument();
    expect(screen.getByText("$600")).toBeInTheDocument();
    expect(screen.getByText("Nofaol")).toBeInTheDocument();
    // no probable owner yet — the badge falls back to a dash rather than an empty cell
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Yunusobod/ })).toHaveAttribute("href", "/properties/p2");
  });
});
