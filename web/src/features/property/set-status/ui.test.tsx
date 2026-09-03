import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fork } from "effector";
import { Provider } from "effector-react";
import type { PropertyDetail } from "@/entities/property";
import { i18nReady } from "@/shared/i18n";
import { StatusButtons } from "./ui";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const property: Pick<PropertyDetail, "id" | "status"> = { id: "p1", status: "active" };

describe("StatusButtons", () => {
  beforeAll(() => i18nReady);

  it("disables Faol while the property is active, and leaves Nofaol enabled", () => {
    render(<Provider value={fork()}><StatusButtons property={property} /></Provider>);
    expect(screen.getByRole("button", { name: "Faol" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nofaol" })).toBeEnabled();
  });

  it("posts the note on Nofaol and clears it once the write succeeds", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      urls.push(req.url);
      bodies.push(await req.json());
      return new Response(JSON.stringify({ id: 2, from_status: "active", to_status: "inactive", actor_type: "agent", actor_id: "u1", note: "left", created_at: "2026-08-29T13:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const scope = fork();
    render(<Provider value={scope}><StatusButtons property={property} /></Provider>);

    const note = screen.getByLabelText("Izoh");
    await userEvent.type(note, "left");
    await userEvent.click(screen.getByRole("button", { name: "Nofaol" }));

    await waitFor(() => expect(bodies[0]).toEqual({ status: "inactive", note: "left" }));
    expect(urls[0]).toContain("/api/v1/properties/p1/status");

    // only after the POST succeeded does the draft clear
    await waitFor(() => expect(note).toHaveValue(""));
  });

  it("keeps the note when the write fails, so nothing typed is lost", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "about:blank", title: "x", status: 500, detail: "x", code: "internal_error" }), { status: 500, headers: { "content-type": "application/problem+json" } }),
    ));
    const scope = fork();
    render(<Provider value={scope}><StatusButtons property={property} /></Provider>);

    const note = screen.getByLabelText("Izoh");
    await userEvent.type(note, "left");
    await userEvent.click(screen.getByRole("button", { name: "Nofaol" }));

    // wait for the request to settle (fail) — the button re-enables once pending clears
    await waitFor(() => expect(screen.getByRole("button", { name: "Nofaol" })).toBeEnabled());
    expect(note).toHaveValue("left");
  });
});
