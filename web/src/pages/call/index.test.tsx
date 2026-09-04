import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider } from "atomic-router-react";
import { allSettled, fork } from "effector";
import { Provider } from "effector-react";
import { createMemoryHistory } from "history";
import { resultingStatus, type CallLogInput, type CallLogResult } from "@/entities/call";
import { $meta, type Meta } from "@/entities/meta";
import { sessionRestored, type User } from "@/entities/session";
import { i18nReady } from "@/shared/i18n";
import { router, routes } from "@/shared/router";
import { $items, MOCK_QUEUE, releaseFx, fetchQueueFx } from "@/entities/queue";
import { submitFx } from "@/features/call/log-result";
import { CallPage } from "./index";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const agent: User = { id: "u1", phone: "+998900000001", name: "Aziz", role: "agent", locale: "uz" };

// A real GET /meta shape with a live fx snapshot — same rate app/router's loadMetaFx would load
// for this screen (see the `authorized.call.opened` wiring).
const META_WITH_FX: Meta = {
  districts: [], statuses: ["new", "active", "inactive"], source_kinds: ["olx", "telegram", "manual"], contact_classifications: ["owner", "agent", "unknown"],
  fx: { date: "2026-09-04", usd_uzs: "12500.00", fetched_at: "2026-09-04T03:00:00Z", stale: false },
  rules: { lock_hours: 4, recheck_days: 3, new_listing_check_days: 2, duplicate_merge_threshold: 0.75, telegram_per_hour: 12, telegram_per_day: 100, sms_per_day: 100 },
};

/** Stands in for the real POST /properties/{id}/call-log — echoes a receipt the way the server would. */
async function fakeLogCall(input: CallLogInput): Promise<CallLogResult> {
  return { id: "cl-1", queueItemId: input.queueItemId, outcome: input.outcome, resultingStatus: resultingStatus(input.outcome), loggedAt: "2026-09-04T09:00:00Z" };
}

async function mount(path: string, meta: Meta | null = META_WITH_FX) {
  const scope = fork({
    values: [[$items, MOCK_QUEUE], [$meta, meta]],
    handlers: [
      [releaseFx, async () => undefined],
      [fetchQueueFx, async () => MOCK_QUEUE],
      [submitFx, async (input: CallLogInput) => fakeLogCall(input)],
    ],
  });
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
    // the real fx rate from $meta.fx.usd_uzs (12500) — 450 * 12500 = 5 625 000 so'm
    expect(screen.getByText("≈ 5 625 000 so'm")).toBeInTheDocument();
    expect(screen.getByText("+998 90 811 24 37")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bo'sh — hali bor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Topshirilgan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Javob yo'q" })).toBeInTheDocument();
    expect(screen.getByText(/Saqlash — holat:/)).toBeInTheDocument();
  });

  it("hides the so'm line rather than show a fake rate when $meta or $meta.fx hasn't loaded", async () => {
    await mount("/queue/1042", null);
    expect(screen.getByText("$450")).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument();
  });

  it("renders a not-found message for an unknown id", async () => {
    await mount("/queue/does-not-exist");
    expect(screen.getByText("Uy topilmadi")).toBeInTheDocument();
  });

  it("choosing Bo'sh — hali bor updates the save button's status to the vacant label", async () => {
    await mount("/queue/1042");

    await userEvent.click(screen.getByRole("button", { name: "Bo'sh — hali bor" }));
    const save = screen.getByRole("button", { name: /Saqlash/ });
    expect(save).toHaveTextContent("Saqlash — holat: Bo'sh");
    expect(save).toBeEnabled();
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
