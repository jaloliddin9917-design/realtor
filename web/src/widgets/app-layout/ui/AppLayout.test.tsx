import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { AppLayout } from "./AppLayout";

const admin: User = { id: "u1", phone: "+998900000001", name: "Aziz", role: "admin", locale: "uz" };
const agent: User = { ...admin, id: "u2", name: "Bekzod", role: "agent" };

async function mount(user: User) {
  const scope = fork();
  await allSettled(sessionRestored, { scope, params: user });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/properties"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}>
        <AppLayout title="Uylar" actions={<button type="button">action</button>}>{null}</AppLayout>
      </RouterProvider>
    </Provider>,
  );
}

describe("AppLayout", () => {
  beforeAll(() => i18nReady);

  it("shows the title, the actions a page passes and the signed-in user", async () => {
    await mount(admin);
    expect(screen.getByRole("heading", { name: "Uylar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action" })).toBeInTheDocument();
    expect(screen.getByText("Aziz")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByLabelText("Chiqish")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manbalar" })).toHaveAttribute("href", "/admin/sources");
  });

  it("hides the admin-only sources link from an agent", async () => {
    await mount(agent);
    expect(screen.getByRole("link", { name: "Uylar" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manbalar" })).not.toBeInTheDocument();
  });
});
