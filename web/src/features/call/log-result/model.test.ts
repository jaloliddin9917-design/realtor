import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { $items } from "@/entities/queue";
import { router, routes } from "@/shared/router";
import { $note, $outcome, $resultingStatus, noteChanged, outcomeChanged, submitRequested } from "./model";

describe("$resultingStatus", () => {
  it("defaults to vacant, and flips to taken only once the taken outcome is chosen", async () => {
    const scope = fork();
    expect(scope.getState($resultingStatus)).toBe("vacant");
    await allSettled(outcomeChanged, { scope, params: "taken" });
    expect(scope.getState($resultingStatus)).toBe("taken");
    await allSettled(outcomeChanged, { scope, params: "no_answer" });
    expect(scope.getState($resultingStatus)).toBe("vacant");
  });
});

describe("submitRequested", () => {
  it("saves the log, releases the item's lock, resets the draft, and returns to the queue", async () => {
    const scope = fork();
    // routes.queue.navigate only reaches $isOpened through an actual history push (see
    // features/listing/add-manual/model.test.ts for the same pattern).
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue/1042"] }) });
    expect(scope.getState($items).find((i) => i.id === "1042")!.state.kind).toBe("mine");

    await allSettled(outcomeChanged, { scope, params: "taken" });
    await allSettled(noteChanged, { scope, params: "ijaraga berildi" });
    await allSettled(submitRequested, { scope, params: { queueItemId: "1042" } });

    expect(scope.getState($items).find((i) => i.id === "1042")!.state.kind).toBe("new");
    expect(scope.getState($outcome)).toBeNull();
    expect(scope.getState($note)).toBe("");
    expect(scope.getState(routes.queue.$isOpened)).toBe(true);
  });
});
