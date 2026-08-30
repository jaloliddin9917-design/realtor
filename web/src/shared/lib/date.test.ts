import { formatDate } from "./date";

describe("formatDate", () => {
  it("renders a date and a datetime in the locale", () => {
    expect(formatDate("2026-08-29T12:40:00+05:00", "uz", "date")).toMatch(/29/);
    expect(formatDate("2026-08-29T12:40:00+05:00", "ru", "datetime")).toMatch(/12:40|07:40/);
  });
  it("returns a dash for null", () => {
    expect(formatDate(null, "uz", "date")).toBe("—");
  });
});
