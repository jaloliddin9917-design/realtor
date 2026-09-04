import { api, unwrap, type Schemas } from "@/shared/api";

export type CallOutcome = "still_available" | "taken" | "no_answer" | "call_back" | "realtor_not_owner" | "do_not_contact" | "wrong_number";
export type ResultingStatus = "vacant" | "taken" | "unchanged";
export type NextCheckChoice = "in_3_days" | "tomorrow" | "date";

export interface CallConditions {
  foreigners: boolean;
  depositMonths: number | null;
  familyOnly: boolean;
}

export interface NextCheck {
  choice: NextCheckChoice;
  /** Only set (and meaningful) when `choice` is "date". */
  date?: string;
}

export interface CallLogInput {
  queueItemId: string;
  outcome: CallOutcome;
  conditions: CallConditions;
  note: string;
  nextCheck: NextCheck;
}

export interface CallLogResult {
  id: string;
  queueItemId: string;
  outcome: CallOutcome;
  resultingStatus: ResultingStatus;
  loggedAt: string;
}

/** "still_available" (confirmed still on the market) resolves to vacant, "taken" to taken; every
 * other outcome (no answer, call back, wrong number, …) records the call without changing the
 * property's status — see the Call screen spec. This is the local pre-submit prediction shown on
 * the Save button; the server's own `resulting_status` on the receipt is what actually gets
 * recorded (see {@link logCall}). */
export function resultingStatus(outcome: CallOutcome): ResultingStatus {
  if (outcome === "still_available") return "vacant";
  if (outcome === "taken") return "taken";
  return "unchanged";
}

/** `call.outcome.<value>` — the i18n key for one outcome's button/status label. */
export const outcomeKey = (o: CallOutcome): string => `call.outcome.${o}`;

// ---- real API ----
type CheckOut = Schemas["CheckOut"];

/** Map the API's call-log receipt to the view model the UI renders. A queue item's id is the
 * property id, so `property_id` round-trips straight back into `queueItemId`. */
function mapResult(o: CheckOut): CallLogResult {
  return {
    id: o.id,
    queueItemId: o.property_id,
    outcome: o.outcome,
    resultingStatus: o.resulting_status,
    loggedAt: o.logged_at,
  };
}

export function logCall(input: CallLogInput): Promise<CallLogResult> {
  return unwrap(
    api.POST("/api/v1/properties/{property_id}/call-log", {
      params: { path: { property_id: input.queueItemId } },
      body: {
        outcome: input.outcome,
        conditions: {
          foreigners: input.conditions.foreigners,
          deposit_months: input.conditions.depositMonths,
          family_only: input.conditions.familyOnly,
        },
        note: input.note,
        next_check: { choice: input.nextCheck.choice, date: input.nextCheck.date ?? null },
      },
    }),
  ).then(mapResult);
}
