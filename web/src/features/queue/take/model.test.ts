import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { $items } from "@/entities/queue";
import { router, routes } from "@/shared/router";
import { takeRequested } from "./model";

describe("takeRequested", () => {
  it("locks the item as mine and opens the call-log screen for it", async () => {
    const scope = fork();
    // routes.call.navigate only reaches $params through an actual history push (see
    // features/listing/add-manual/model.test.ts for the same pattern).
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue"] }) });

    await allSettled(takeRequested, { scope, params: "1043" });

    expect(scope.getState($items).find((i) => i.id === "1043")!.state.kind).toBe("mine");
    expect(scope.getState(routes.call.$params)).toEqual({ id: "1043" });
  });
});
