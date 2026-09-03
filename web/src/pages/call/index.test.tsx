import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router, routes } from "@/shared/router";
import { CallPage } from "./index";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const agent: User = { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" };

async function mount(path: string) {
  const scope = fork();
  await allSettled(sessionRestored, { scope, params: agent });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><CallPage /></RouterProvider>
    </Provider>,
  );
  return scope;
}

describe("CallPage", () => {
  beforeAll(() => i18nReady);

  it("shows the property snapshot, the owner's phone and the outcome buttons", async () => {
    await mount("/queue/1042");
    expect(screen.getByText(/Chilonzor, Qatortol/)).toBeInTheDocument();
    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.getByText("+998 90 811 24 37")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topshirilgan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Javob yo'q" })).toBeInTheDocument();
    expect(screen.getByText(/Saqlash — holat:/)).toBeInTheDocument();
  });

  it("renders a not-found message for an unknown id", async () => {
    await mount("/queue/does-not-exist");
    expect(screen.getByText("Uy topilmadi")).toBeInTheDocument();
  });

  it("choosing Topshirilgan updates the save button's status label; saving toasts and returns to the queue", async () => {
    const scope = await mount("/queue/1042");

    await userEvent.click(screen.getByRole("button", { name: "Topshirilgan" }));
    const save = screen.getByRole("button", { name: /Saqlash/ });
    expect(save).toHaveTextContent("Topshirilgan");
    expect(save).toBeEnabled();

    await userEvent.click(save);
    await waitFor(() => expect(scope.getState(routes.queue.$isOpened)).toBe(true));
  });
});
