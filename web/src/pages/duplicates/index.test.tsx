import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { fork } from "effector";
import { Provider } from "effector-react";
import { $decidedRecent, $pairs, $thresholds, fetchDuplicatesFx, MOCK_DECIDED_RECENT, MOCK_PAIRS, MOCK_THRESHOLDS } from "@/entities/duplicate";
import { i18nReady } from "@/shared/i18n";
import { router } from "@/shared/router";
import { DuplicatesPage } from "./index";

function mount(pairs = MOCK_PAIRS) {
  // Both stores start empty (see entities/duplicate) and are normally filled by the
  // duplicates.opened wiring in app/router.ts — seeded here the same way pages/dashboard's test
  // seeds its stores, with a `fetchDuplicatesFx` handler as a safety net.
  const scope = fork({
    values: [[$pairs, pairs], [$thresholds, MOCK_THRESHOLDS], [$decidedRecent, MOCK_DECIDED_RECENT]],
    handlers: [[fetchDuplicatesFx, async () => ({ pairs, thresholds: MOCK_THRESHOLDS, decidedRecent: MOCK_DECIDED_RECENT })]],
  });
  render(
    <Provider value={scope}>
      <RouterProvider router={router}><DuplicatesPage /></RouterProvider>
    </Provider>,
  );
  return scope;
}

describe("DuplicatesPage", () => {
  beforeAll(() => i18nReady);

  it("shows the featured pair's score and a score-breakdown line", () => {
    // AppLayout's Sidebar renders atomic-router-react <Link>s, which need a RouterProvider
    // ancestor (see widgets/app-layout/ui/AppLayout.test.tsx for the same wrapping).
    mount();
    expect(screen.getByText("Bu ikki e'lon bitta uymi?")).toBeInTheDocument();
    expect(screen.getByText("0.65")).toBeInTheDocument();
    expect(screen.getByText("Rasmlar")).toBeInTheDocument();
    expect(screen.getByText("+0.30")).toBeInTheDocument();
  });

  it("shows the matched phone next to the phone breakdown row when the API supplies it", () => {
    // The API sets `detail` on the phone signal to the shared number; the featured pair (index 0)
    // gets a real phone match so the compare panel has a detail to render.
    const withPhone = MOCK_PAIRS.map((p, i) =>
      i === 0 ? { ...p, breakdown: p.breakdown.map((b) => (b.id === "phone" ? { ...b, points: 0.5, detail: "+998908112437" } : b)) } : p,
    );
    mount(withPhone);
    expect(screen.getByText("+998908112437")).toBeInTheDocument();
  });

  it("loads a different pair into the compare panel when its queue row is selected", async () => {
    mount();
    await userEvent.click(screen.getByText("0.71"));
    expect(screen.getByText(`2 / ${MOCK_PAIRS.length}`)).toBeInTheDocument();
  });
});
