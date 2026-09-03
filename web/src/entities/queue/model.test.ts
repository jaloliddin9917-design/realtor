import { allSettled, fork } from "effector";
import { $items, released, take } from "./model";

describe("take", () => {
  it("locks the item as mine, roughly four hours out, and leaves other items untouched", async () => {
    const scope = fork();
    const before = scope.getState($items).find((i) => i.id === "1043")!;
    expect(before.state.kind).toBe("new");

    await allSettled(take, { scope, params: "1043" });

    const items = scope.getState($items);
    const taken = items.find((i) => i.id === "1043")!;
    expect(taken.state.kind).toBe("mine");
    const untilMs = new Date(taken.state.until!).getTime();
    expect(untilMs).toBeGreaterThan(Date.now() + 3.9 * 60 * 60 * 1000);
    expect(untilMs).toBeLessThan(Date.now() + 4.1 * 60 * 60 * 1000);

    // an unrelated item (still locked by another agent) is untouched
    const other = items.find((i) => i.id === "1044")!;
    expect(other.state).toEqual({ kind: "locked", until: other.state.until, agentName: "Malika" });
  });
});

describe("released", () => {
  it("clears a lock back to new", async () => {
    const scope = fork();
    expect(scope.getState($items).find((i) => i.id === "1042")!.state.kind).toBe("mine");

    await allSettled(released, { scope, params: "1042" });

    const item = scope.getState($items).find((i) => i.id === "1042")!;
    expect(item.state).toEqual({ kind: "new" });
  });
});
