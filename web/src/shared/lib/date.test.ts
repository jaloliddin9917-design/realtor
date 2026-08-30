import { formatDate } from "./date";

describe("formatDate", () => {
  it("renders a date and a datetime in the locale", () => {
    expect(formatDate("2026-08-29T12:40:00+05:00", "uz", "date")).toMatch(/29/);
    expect(formatDate("2026-08-29T12:40:00+05:00", "ru", "datetime")).toMatch(/12:40/); // Asia/Tashkent, never the runner's zone
    expect(formatDate("2026-08-29T07:40:00Z", "uz", "datetime")).toMatch(/12:40/);
  });
  it("returns a dash for null", () => {
    expect(formatDate(null, "uz", "date")).toBe("—");
  });
});
