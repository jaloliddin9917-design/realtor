import { formatMoney, formatUsdFromMinor } from "./money";

describe("formatMoney", () => {
  it("formats USD whole dollars", () => {
    expect(formatMoney(45000, "USD", "uz")).toBe("$450");
    expect(formatMoney(45000, "USD", "ru")).toBe("$450");
  });
  it("formats UZS with thin spaces and so'm", () => {
    expect(formatMoney(535500000, "UZS", "uz")).toBe("5 355 000 so'm");
    expect(formatMoney(535500000, "UZS", "ru")).toBe("5 355 000 сум");
  });
  it("returns a dash for missing values", () => {
    expect(formatMoney(null, null, "uz")).toBe("—");
    expect(formatUsdFromMinor(null)).toBe("—");
    expect(formatUsdFromMinor(30000)).toBe("$300");
  });
  it("returns a dash for non-finite amounts", () => {
    expect(formatMoney(NaN, "USD", "uz")).toBe("—");
    expect(formatMoney(Infinity, "USD", "uz")).toBe("—");
    expect(formatMoney(-Infinity, "UZS", "uz")).toBe("—");
  });
});
