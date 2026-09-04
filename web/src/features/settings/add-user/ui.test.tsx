import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fork } from "effector";
import { Provider } from "effector-react";
import { toast } from "sonner";
import { $users } from "@/entities/setting";
import { i18n, i18nReady } from "@/shared/i18n";
import { AddUserDialog } from "./ui";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail: "x", code }), { status, headers: { "content-type": "application/problem+json" } });
}

async function openAndFill() {
  await userEvent.click(screen.getByRole("button", { name: "Qo'shish" }));
  await userEvent.type(screen.getByLabelText("Ism"), "Nodira");
  await userEvent.type(screen.getByLabelText("Telefon"), "+998901234567");
  await userEvent.type(screen.getByLabelText("Parol"), "secret123");
}

describe("AddUserDialog", () => {
  beforeAll(() => i18nReady);

  it("posts the typed password to POST /api/v1/users, then refetches the list and closes", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (req: Request) => {
      urls.push(`${req.method} ${req.url}`);
      if (req.method === "POST") {
        bodies.push(await req.json());
        return new Response(JSON.stringify({ id: "u9", name: "Nodira", phone: "+998901234567", role: "agent", active: true, created_at: "2026-09-05T00:00:00Z" }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify([{ id: "u9", name: "Nodira", phone: "+998901234567", role: "agent", active: true, created_at: "2026-09-05T00:00:00Z" }]), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const scope = fork();
    render(<Provider value={scope}><AddUserDialog /></Provider>);

    await openAndFill();
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));

    await waitFor(() => expect(bodies[0]).toEqual({ name: "Nodira", phone: "+998901234567", password: "secret123", role: "agent" }));
    expect(urls.some((u) => u.startsWith("POST") && u.includes("/api/v1/users"))).toBe(true);
    // the dialog closes once the create succeeds
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // and the refetch (not a local append) is what fills $users
    await waitFor(() => expect(urls.some((u) => u.startsWith("GET") && u.includes("/api/v1/users"))).toBe(true));
    await waitFor(() => expect(scope.getState($users)).toEqual([{ id: "u9", name: "Nodira", phone: "+998901234567", role: "agent", active: true }]));
  });

  it("surfaces a 409 user.exists as a toast and keeps the dialog open with what was typed", async () => {
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => problem(409, "user.exists")));
    const scope = fork();
    render(<Provider value={scope}><AddUserDialog /></Provider>);

    await openAndFill();
    await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(i18n.t("errors.user.exists")));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Ism")).toHaveValue("Nodira");
  });
});
