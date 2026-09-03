import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { $items, MOCK_QUEUE, releaseFx, fetchQueueFx } from "@/entities/queue";
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
  it("saves the log, releases the item's lock on the server, resets the draft, and returns to the queue", async () => {
    let releasedId: string | null = null;
    const scope = fork({
      values: [[$items, MOCK_QUEUE]],
      // the real lock release is a server call (POST release); mock it so the log flow can be
      // asserted without a backend, and capture the id it releases.
      handlers: [
        [releaseFx, async (id: string) => { releasedId = id; }],
        [fetchQueueFx, async () => MOCK_QUEUE],
      ],
    });
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue/1042"] }) });

    await allSettled(outcomeChanged, { scope, params: "taken" });
    await allSettled(noteChanged, { scope, params: "ijaraga berildi" });
    await allSettled(submitRequested, { scope, params: { queueItemId: "1042" } });

    expect(releasedId).toBe("1042");
    expect(scope.getState($outcome)).toBeNull();
    expect(scope.getState($note)).toBe("");
    expect(scope.getState(routes.queue.$isOpened)).toBe(true);
  });
});
