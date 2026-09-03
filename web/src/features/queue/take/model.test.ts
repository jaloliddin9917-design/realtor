import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { takeFx, type QueueItem } from "@/entities/queue";
import { router, routes } from "@/shared/router";
import { takeRequested } from "./model";

const claimed: QueueItem = {
  id: "x1", propertyId: "x1", district: "chilonzor", subArea: "Qatortol", rooms: 2, floor: 3, totalFloors: 9,
  areaSqm: 54, priceUsd: 450, availability: { status: "unknown", at: new Date().toISOString() },
  owner: { phone: "", classification: "unknown" }, lastActivity: { text: "", at: new Date().toISOString() },
  state: { kind: "mine" }, source: "olx",
};

describe("takeRequested", () => {
  it("claims the item, then opens its call-log screen once the claim succeeds", async () => {
    const scope = fork({ handlers: [[takeFx, async () => claimed]] });
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue"] }) });
    await allSettled(takeRequested, { scope, params: "x1" });
    expect(scope.getState(routes.call.$params)).toEqual({ id: "x1" });
  });
});
