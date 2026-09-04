import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { $detail, type PropertyDetail } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertyPage } from "./index";

const detail = {
  id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54, price_usd_min_minor: 45000, source_removed: false, needs_recheck: false,
  first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"],
  probable_owner: { contact_id: "c1", kind: "phone", identifier: "+998908112437", display_name: null, classification: "owner", agency_score: 0.1, confidence: 0.8 },
  photo_url: "/api/v1/photos/l1/0.jpg", last_status_event: null,
  listings: [
    { id: "l1", source: { id: "s1", kind: "olx", name: "olx-tashkent" }, external_id: "77", url: "https://www.olx.uz/d/x-ID77.html", title: "2-комн", description: "", price: { amount_minor: 45000, currency: "USD", usd_minor: 45000 }, rooms: 2, area_sqm: 54, floor: 3, total_floors: 9, district: "chilonzor", address_text: null, posted_at: "2026-08-12T09:00:00Z", first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", source_removed: false, owner_marker: true, agent_marker: false, parse_confidence: 0.9, photos: [{ position: 0, url: "/api/v1/photos/l1/0.jpg", width: 300, height: 200 }, { position: 1, url: "/api/v1/photos/l1/1.jpg", width: 300, height: 200 }], contacts: [{ id: "c1", kind: "phone", identifier: "+998908112437", display_name: null, classification: "owner", agency_score: 0.1 }] },
    { id: "l2", source: { id: "s2", kind: "telegram", name: "@chan" }, external_id: "5", url: "https://t.me/chan/5", title: "", description: "", price: { amount_minor: 48000, currency: "USD", usd_minor: 48000 }, rooms: 2, area_sqm: null, floor: null, total_floors: null, district: "chilonzor", address_text: null, posted_at: "2026-08-14T09:00:00Z", first_seen_at: "2026-08-14T09:00:00Z", last_seen_at: "2026-08-20T09:00:00Z", source_removed: true, owner_marker: false, agent_marker: false, parse_confidence: 0.7, photos: [], contacts: [{ id: "c2", kind: "phone", identifier: "+998934021855", display_name: null, classification: "agent", agency_score: 0.8 }] },
  ],
  status_events: [{ id: 2, from_status: "new", to_status: "active", actor_type: "agent", actor_id: "u1", note: "6 oy", created_at: "2026-08-29T12:40:00Z" }, { id: 1, from_status: null, to_status: "new", actor_type: "crawler", actor_id: null, note: null, created_at: "2026-08-12T09:00:00Z" }],
  duplicates: [{ property_id: "p9", score: 0.62 }],
} as PropertyDetail;

/** AppLayout's Sidebar and the page's back link render atomic-router <Link>s, which need a RouterProvider. */
function mount(value: PropertyDetail | null) {
  return render(
    <Provider value={fork({ values: [[$detail, value]] })}>
      <RouterProvider router={router}><PropertyPage /></RouterProvider>
    </Provider>,
  );
}

describe("PropertyPage", () => {
  beforeAll(() => i18nReady);

  it("renders header, owner, listings, duplicate note and timeline", () => {
    const { container } = mount(detail);
    // the header's cheapest-listing price and listing l1's own price are both $450
    expect(screen.getAllByText("$450")).toHaveLength(2);
    expect(screen.getByText("+998 90 811 24 37")).toBeInTheDocument();
    expect(screen.getByText("ishonch 0.8")).toBeInTheDocument();
    expect(screen.getByText("+998 93 402 18 55")).toBeInTheDocument();
    expect(screen.getAllByText("OLX").length).toBeGreaterThan(0);
    expect(screen.getByText("manbadan o'chirilgan")).toBeInTheDocument();
    expect(screen.getByText(/Ehtimoliy dublikat/)).toBeInTheDocument();
    expect(screen.getByText("6 oy")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Faol" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nofaol" })).toBeEnabled();
    // two photos render: the first carries the meaningful alt, the second is decorative
    expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "/api/v1/photos/l1/0.jpg");
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("alt", "Uy rasmi");
    expect(imgs[1]).toHaveAttribute("alt", "");
  });

  it("lists the status events newest first, with the actor", () => {
    mount(detail);
    const entries = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(entries[0]).toContain("Agent");
    expect(entries[0]).toContain("Faol");
    expect(entries[1]).toContain("Tizim");
    expect(entries[1]).toContain("Yangi");
  });

  it("says so when the property is not there", () => {
    mount(null);
    expect(screen.getByText("Uy topilmadi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nofaol" })).not.toBeInTheDocument();
  });

  it("opens a lightbox to browse every photo from the '+N' tile", async () => {
    const l0 = detail.listings[0]!;
    const four = { ...detail, listings: [{ ...l0, photos: [0, 1, 2, 3].map((n) => ({ position: n, url: `/api/v1/photos/l1/${n}.jpg`, width: 300, height: 200 })) }, detail.listings[1]!] } as PropertyDetail;
    mount(four);
    // the preview shows the first two photos and a "+2" tile for the remaining two
    await userEvent.click(screen.getByText("+2"));
    // the lightbox opens at the third photo, with a position counter and next/prev controls
    expect(screen.getByText("3 / 4")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keyingi rasm" }));
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
  });

});
