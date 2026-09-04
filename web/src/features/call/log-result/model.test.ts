import { allSettled, fork } from "effector";
import { createMemoryHistory } from "history";
import { resultingStatus, type CallLogInput, type CallLogResult } from "@/entities/call";
import { $items, MOCK_QUEUE, releaseFx, fetchQueueFx } from "@/entities/queue";
import { router, routes } from "@/shared/router";
import { $note, $outcome, $resultingStatus, noteChanged, outcomeChanged, submitFx, submitRequested } from "./model";

/** A stand-in for the real `logCall`, echoing back a receipt the way the server would. */
async function fakeLogCall(input: CallLogInput): Promise<CallLogResult> {
  return { id: "cl-1", queueItemId: input.queueItemId, outcome: input.outcome, resultingStatus: resultingStatus(input.outcome), loggedAt: "2026-09-04T09:00:00Z" };
}

describe("$resultingStatus", () => {
  it("defaults to vacant, taken once taken is chosen, vacant for still_available, unchanged for everything else", async () => {
    const scope = fork();
    expect(scope.getState($resultingStatus)).toBe("vacant");
    await allSettled(outcomeChanged, { scope, params: "taken" });
    expect(scope.getState($resultingStatus)).toBe("taken");
    await allSettled(outcomeChanged, { scope, params: "still_available" });
    expect(scope.getState($resultingStatus)).toBe("vacant");
    await allSettled(outcomeChanged, { scope, params: "no_answer" });
    expect(scope.getState($resultingStatus)).toBe("unchanged");
  });
});

describe("submitRequested", () => {
  it("saves the log through the real submit effect, releases the item's lock on the server, resets the draft, and returns to the queue", async () => {
    let releasedId: string | null = null;
    let submitted: CallLogInput | null = null;
    const scope = fork({
      values: [[$items, MOCK_QUEUE]],
      handlers: [
        // the real lock release is a server call (POST release); mock it so the log flow can be
        // asserted without a backend, and capture the id it releases.
        [releaseFx, async (id: string) => { releasedId = id; }],
        [fetchQueueFx, async () => MOCK_QUEUE],
        // the real submit hits POST /properties/{id}/call-log; mock the effect itself so this
        // flow can be asserted without a backend, and capture what it was asked to send.
        [submitFx, async (input: CallLogInput) => { submitted = input; return fakeLogCall(input); }],
      ],
    });
    await allSettled(router.setHistory, { scope, params: createMemoryHistory({ initialEntries: ["/queue/1042"] }) });

    await allSettled(outcomeChanged, { scope, params: "taken" });
    await allSettled(noteChanged, { scope, params: "ijaraga berildi" });
    await allSettled(submitRequested, { scope, params: { queueItemId: "1042" } });

    expect(submitted).toMatchObject({ queueItemId: "1042", outcome: "taken", note: "ijaraga berildi" });
    expect(releasedId).toBe("1042");
    expect(scope.getState($outcome)).toBeNull();
    expect(scope.getState($note)).toBe("");
    expect(scope.getState(routes.queue.$isOpened)).toBe(true);
  });
});
