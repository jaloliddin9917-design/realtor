import { allSettled, fork } from "effector";
import { $current, $decidedRecent, $index, $pairs, $thresholds, fetchDuplicatesFx, pairDecided, pairSelected } from "./model";
import type { DuplicatePair, DuplicateQueue } from "./api";

const side: DuplicatePair["a"] = {
  sourceKind: "olx", sourceLabel: "OLX.uz", postedAt: null, title: "t", priceUsdMinor: null,
  rooms: 2, floor: 1, totalFloors: 5, areaSqm: 40, district: "chilonzor", description: "d",
  phone: "", classification: "unknown", photos: [],
};
const pair = (id: string, score: number): DuplicatePair => ({ id, score, createdAt: new Date().toISOString(), a: side, b: side, breakdown: [] });

describe("duplicate model", () => {
  it("fetchDuplicatesFx fills $pairs, $thresholds and $decidedRecent from the API", async () => {
    const queue: DuplicateQueue = {
      pairs: [pair("a", 0.6), pair("b", 0.7)],
      thresholds: { auto: 0.75, low: 0.5, high: 0.75 },
      decidedRecent: { days: 30, count: 10, mergedPct: 80 },
    };
    const scope = fork({ handlers: [[fetchDuplicatesFx, async () => queue]] });
    await allSettled(fetchDuplicatesFx, { scope });
    expect(scope.getState($pairs).map((p) => p.id)).toEqual(["a", "b"]);
    expect(scope.getState($thresholds)).toEqual(queue.thresholds);
    expect(scope.getState($decidedRecent)).toEqual(queue.decidedRecent);
  });

  it("pairDecided drops the pair and leaves the pager on whatever now sits in its slot", async () => {
    const scope = fork({ values: [[$pairs, [pair("a", 0.9), pair("b", 0.8), pair("c", 0.7)]], [$index, 1]] });
    await allSettled(pairDecided, { scope, params: "b" });
    expect(scope.getState($pairs).map((p) => p.id)).toEqual(["a", "c"]);
    // index 1 was "b"; after removal index 1 is "c" — the pager needs no change to land there
    expect(scope.getState($index)).toBe(1);
    expect(scope.getState($current)?.id).toBe("c");
  });

  it("pairDecided clamps the pager back when the decided pair was the last one", async () => {
    const scope = fork({ values: [[$pairs, [pair("a", 0.9), pair("b", 0.8)]], [$index, 1]] });
    await allSettled(pairDecided, { scope, params: "b" });
    expect(scope.getState($pairs).map((p) => p.id)).toEqual(["a"]);
    expect(scope.getState($index)).toBe(0);
  });

  it("pairSelected sets $index directly (queue row click / pager buttons)", async () => {
    const scope = fork({ values: [[$pairs, [pair("a", 0.9), pair("b", 0.8)]]] });
    await allSettled(pairSelected, { scope, params: 1 });
    expect(scope.getState($index)).toBe(1);
    expect(scope.getState($current)?.id).toBe("b");
  });
});
