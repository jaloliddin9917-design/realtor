import { formatPhone } from "./phone";

describe("formatPhone", () => {
  it("groups an Uzbek E.164 number", () => {
    expect(formatPhone("+998908112437")).toBe("+998 90 811 24 37");
  });
  it("leaves other identifiers alone", () => {
    expect(formatPhone("@some_user")).toBe("@some_user");
  });
});
