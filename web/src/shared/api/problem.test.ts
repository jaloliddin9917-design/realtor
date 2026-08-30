import { ApiProblem, isApiProblem, problemFrom } from "./problem";

describe("problemFrom", () => {
  it("parses an RFC 7807 body with code and errors", () => {
    const p = problemFrom(422, {
      type: "about:blank", title: "Unprocessable Entity", status: 422, detail: "request validation failed",
      code: "validation_error", errors: [{ loc: ["body", "phone"], msg: "missing", type: "missing" }],
    });
    expect(p).toBeInstanceOf(ApiProblem);
    expect(p.code).toBe("validation_error");
    expect(p.fieldError("phone")).toBe("missing");
    expect(p.fieldError("password")).toBeNull();
  });
  it("falls back to unknown for a non-problem body", () => {
    const p = problemFrom(502, "<html>bad gateway</html>");
    expect(p.code).toBe("unknown");
    expect(p.status).toBe(502);
    expect(isApiProblem(p)).toBe(true);
    expect(isApiProblem(new Error("x"))).toBe(false);
  });
});
