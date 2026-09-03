import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { DuplicatesPage } from "./index";

describe("DuplicatesPage", () => {
  beforeAll(() => i18nReady);

  it("shows the featured pair's score and a score-breakdown line", () => {
    // AppLayout's Sidebar renders atomic-router-react <Link>s, which need a RouterProvider
    // ancestor (see widgets/app-layout/ui/AppLayout.test.tsx for the same wrapping).
    render(
      <Provider value={fork()}>
        <RouterProvider router={router}><DuplicatesPage /></RouterProvider>
      </Provider>,
    );
    expect(screen.getByText("Bu ikki e'lon bitta uymi?")).toBeInTheDocument();
    expect(screen.getByText("0.65")).toBeInTheDocument();
    expect(screen.getByText("Rasmlar — 2 juft o'xshash (masofa 6)")).toBeInTheDocument();
    expect(screen.getByText("+0.30")).toBeInTheDocument();
  });

  it("loads a different pair into the compare panel when its queue row is selected", async () => {
    render(
      <Provider value={fork()}>
        <RouterProvider router={router}><DuplicatesPage /></RouterProvider>
      </Provider>,
    );
    await userEvent.click(screen.getByText("0.71"));
    expect(screen.getByText("2 / 12")).toBeInTheDocument();
  });
});
