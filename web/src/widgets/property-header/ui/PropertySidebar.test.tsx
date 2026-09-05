import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { $meta, type Meta } from "@/entities/meta";
import type { PropertyDetail } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { PropertySidebar } from "./PropertySidebar";

// A real GET /meta shape with a live fx snapshot, matching the one app/router's loadMetaFx would
// load for this route (routes.property is one of its trigger routes).
const META_WITH_FX: Meta = {
  districts: [], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"],
  fx: { date: "2026-09-04", usd_uzs: "12500.00", fetched_at: "2026-09-04T03:00:00Z", stale: false },
  rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: 12, telegram_per_day: 100, sms_per_day: 100 },
};

const base = {
  id: "p1", status: "active", district: "chilonzor", rooms: 2, floor: 3, total_floors: 9, area_sqm: 54,
  price_usd_min_minor: 45000, source_removed: false, needs_recheck: false,
  first_seen_at: "2026-08-12T09:00:00Z", last_seen_at: "2026-08-29T12:40:00Z", listing_count: 2, source_kinds: ["olx", "telegram"],
  probable_owner: { contact_id: "c1", kind: "phone", identifier: "+998908112437", display_name: null, classification: "owner", agency_score: 0.1, confidence: 0.8 },
  photo_url: null, last_status_event: null,
  latitude: null, longitude: null, location_label: null, location_radius_m: null,
  building_type: null, is_furnished: null, renovation: null, year_built: null,
  listings: [], status_events: [], duplicates: [],
} as PropertyDetail;

function mount(detail: PropertyDetail, meta: Meta | null = META_WITH_FX) {
  const scope = fork({ values: [[$meta, meta]] });
  return render(
    <Provider value={scope}>
      <RouterProvider router={router}><PropertySidebar detail={detail} /></RouterProvider>
    </Provider>,
  );
}

describe("PropertySidebar", () => {
  beforeAll(() => i18nReady);

  it("shows the price, an approximate so'm conversion (from the real fx rate), status and owner badges", () => {
    mount(base);
    expect(screen.getByText("$450")).toBeInTheDocument();
    // 450 * 12500 = 5 625 000 so'm
    expect(screen.getByText("≈ 5 625 000 so'm")).toBeInTheDocument();
    expect(screen.getByText("Egasi · 0.8")).toBeInTheDocument();
  });

  it("hides the so'm line rather than fabricate a rate when $meta.fx hasn't loaded", () => {
    mount(base, null);
    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("masks the contact-card phone until revealed, then offers a real tel: call", async () => {
    mount(base);
    // OwnerBadge (price card) always shows the real number; the contact card starts masked
    expect(screen.getAllByText("+998 90 811 24 37")).toHaveLength(1);
    expect(screen.getByText("+998 90 ••• •• 37")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Telefonni ko'rsatish" }));

    expect(screen.getAllByText("+998 90 811 24 37")).toHaveLength(2);
    expect(screen.queryByText("+998 90 ••• •• 37")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hozir qo'ng'iroq qilish/ })).toHaveAttribute("href", "tel:+998908112437");
  });

  it("does not offer a take-and-call action (that label belongs to the real queue take/lock flow, which this page can't wire up)", () => {
    mount(base);
    expect(screen.queryByRole("link", { name: /Olish va qo'ng'iroq qilish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Olish va qo'ng'iroq qilish/ })).not.toBeInTheDocument();
  });

  it("disables the phone action when the property has no resolvable contact", () => {
    mount({ ...base, probable_owner: null, listings: [] });
    expect(screen.getByText("Egasi aniqlanmagan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Telefonni ko'rsatish" })).toBeDisabled();
  });

  it("shows the source, first-seen date and listing count in the meta list", () => {
    mount(base);
    expect(screen.getByText("Manba")).toBeInTheDocument();
    expect(screen.getByText("OLX · Telegram")).toBeInTheDocument();
    expect(screen.getByText("Birinchi ko'rilgan")).toBeInTheDocument();
    expect(screen.getByText("12-avg")).toBeInTheDocument();
    expect(screen.getByText("E'lonlar")).toBeInTheDocument();
    expect(screen.getByText("2 · OLX · Telegram")).toBeInTheDocument();
  });

  it("shows a recheck prompt only when needs_recheck is true, linking back to the queue", () => {
    mount({ ...base, needs_recheck: true });
    expect(screen.getByText(/Qayta tekshirish kerak/)).toBeInTheDocument();
    expect(screen.getByText(/kun oldin tasdiqlangan/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tekshirish" })).toBeInTheDocument();
  });

  it("hides the recheck prompt when needs_recheck is false", () => {
    mount(base);
    expect(screen.queryByText(/Qayta tekshirish kerak/)).not.toBeInTheDocument();
  });
});
