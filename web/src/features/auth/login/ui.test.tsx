import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fork } from "effector";
import { Provider } from "effector-react";
import { i18nReady } from "@/shared/i18n";
import { LoginForm } from "./ui";

function problem(status: number, code: string): Response {
  return new Response(JSON.stringify({ type: "about:blank", title: "x", status, detail: "x", code }), { status, headers: { "content-type": "application/problem+json" } });
}

describe("LoginForm", () => {
  beforeAll(() => i18nReady);

  it("shows the translated problem for wrong credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => problem(401, "auth.invalid_credentials")));
    const scope = fork();
    render(<Provider value={scope}><LoginForm /></Provider>);
    await userEvent.type(screen.getByLabelText("Telefon"), "+998900000002");
    await userEvent.type(screen.getByLabelText("Parol"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Kirish" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Telefon yoki parol noto'g'ri"));
  });
});
