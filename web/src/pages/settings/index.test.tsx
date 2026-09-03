import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { SettingsPage } from "./index";

const admin: User = { id: "u1", phone: "+998900000001", name: "Sardor", role: "admin", locale: "uz" };

async function mount() {
  const scope = fork();
  await allSettled(sessionRestored, { scope, params: admin });
  await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/settings"] }) });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><SettingsPage /></RouterProvider>
    </Provider>,
  );
}

describe("SettingsPage", () => {
  beforeAll(() => i18nReady);

  it("shows the users table, the sources and channel overviews, and the rules form", async () => {
    await mount();
    expect(screen.getByRole("heading", { name: "Sozlamalar" })).toBeInTheDocument();
    // the users table (Sardor is the admin from the mockup, seeded straight into $users) —
    // scoped to a table cell since the signed-in Sardor's name also appears in the sidebar
    expect(screen.getByRole("cell", { name: "Sardor" })).toBeInTheDocument();
    expect(screen.getByText("faol · hozir onlayn")).toBeInTheDocument();
    // the Manbalar and Bot kanallari overviews
    expect(screen.getByText(/OLX\.uz/)).toBeInTheDocument();
    expect(screen.getByText(/Telegram — jamoa akkaunti/)).toBeInTheDocument();
    // a rule's default value, editable in the form
    expect(screen.getByLabelText("Qulf muddati (olingan uy)")).toHaveValue(4);
    expect(screen.getByRole("button", { name: "Saqlash" })).toBeInTheDocument();
  });

  it("renders the add-user dialog trigger", async () => {
    await mount();
    expect(screen.getByRole("button", { name: "Qo'shish" })).toBeInTheDocument();
  });
});
