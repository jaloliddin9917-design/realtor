export interface ValidationIssue { loc: string[]; msg: string; type: string }

/** RFC 7807 problem as the API emits it (spec §10); `code` is what the UI translates. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly errors: ValidationIssue[];
  constructor(status: number, code: string, detail: string, errors: ValidationIssue[] = []) {
    super(detail);
    this.name = "ApiProblem";
    this.status = status; this.code = code; this.detail = detail; this.errors = errors;
  }
  /** Message for a body field (`loc` like ["body", "phone"]), or null. */
  fieldError(field: string): string | null {
    const hit = this.errors.find((e) => e.loc[e.loc.length - 1] === field);
    return hit ? hit.msg : null;
  }
}

export function isApiProblem(e: unknown): e is ApiProblem {
  return e instanceof ApiProblem;
}

export function problemFrom(status: number, body: unknown): ApiProblem {
  if (body && typeof body === "object" && "code" in body) {
    const b = body as { code?: unknown; detail?: unknown; errors?: unknown };
    const errors = Array.isArray(b.errors) ? (b.errors as ValidationIssue[]) : [];
    return new ApiProblem(status, String(b.code ?? "unknown"), String(b.detail ?? ""), errors);
  }
  return new ApiProblem(status, "unknown", typeof body === "string" ? body.slice(0, 200) : "");
}
