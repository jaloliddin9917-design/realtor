import { render, screen } from "@testing-library/react";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { DashboardPage } from "./index";

describe("DashboardPage", () => {
  beforeAll(() => i18nReady);

  it("shows the stat cards, an agent's activity and the recheck list", () => {
    // AppLayout's Sidebar renders atomic-router-react <Link>s, which need a RouterProvider
    // ancestor (see widgets/app-layout/ui/AppLayout.test.tsx for the same wrapping).
    render(
      <Provider value={fork()}>
        <RouterProvider router={router}><DashboardPage /></RouterProvider>
      </Provider>,
    );
    expect(screen.getByText("121 tasi 3 kun ichida tasdiqlangan")).toBeInTheDocument();
    expect(screen.getByText("Aziz")).toBeInTheDocument();
    expect(screen.getByText("Chilonzor · 2-xonali · 16:05 gacha")).toBeInTheDocument();
    expect(screen.getByText("e'lon OLX dan o'chirilgan")).toBeInTheDocument();
  });
});
