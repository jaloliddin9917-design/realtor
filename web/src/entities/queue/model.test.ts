import { allSettled, fork } from "effector";
import { $items, fetchQueueFx, released, releaseFx, take, takeFx } from "./model";
import type { QueueItem } from "./api";

const base: QueueItem = {
  id: "x", propertyId: "x", district: "chilonzor", subArea: "Qatortol", rooms: 2, floor: 3, totalFloors: 9,
  areaSqm: 54, priceUsd: 450, availability: { status: "unknown", at: new Date().toISOString() },
  owner: { phone: "", classification: "unknown" }, lastActivity: { text: "", at: new Date().toISOString() },
  state: { kind: "new" }, source: "olx",
};
const item = (over: Partial<QueueItem>): QueueItem => ({ ...base, ...over });

describe("queue model", () => {
  it("fetchQueueFx fills $items from the API", async () => {
    const rows = [item({ id: "a" }), item({ id: "b" })];
    const scope = fork({ handlers: [[fetchQueueFx, async () => rows]] });
    await allSettled(fetchQueueFx, { scope });
    expect(scope.getState($items).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("take claims the item via takeFx and swaps it into $items as mine", async () => {
    const scope = fork({
      values: [[$items, [item({ id: "x1", state: { kind: "new" } })]]],
      handlers: [[takeFx, async (id: string) => item({ id, state: { kind: "mine", until: new Date(Date.now() + 4 * 3600_000).toISOString() } })]],
    });
    await allSettled(take, { scope, params: "x1" });
    expect(scope.getState($items).find((i) => i.id === "x1")!.state.kind).toBe("mine");
  });

  it("released calls releaseFx for that item", async () => {
    let seen: string | null = null;
    const scope = fork({
      handlers: [
        [releaseFx, async (id: string) => { seen = id; }],
        [fetchQueueFx, async () => []],
      ],
    });
    await allSettled(released, { scope, params: "x9" });
    expect(seen).toBe("x9");
  });
});
