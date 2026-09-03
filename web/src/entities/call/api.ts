export type CallOutcome = "taken" | "no_answer" | "call_back" | "realtor_not_owner" | "do_not_contact" | "wrong_number";
export type ResultingStatus = "vacant" | "taken";
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

/** Every outcome resolves to "vacant" except "taken" (Topshirilgan) — see the Call screen spec. */
export function resultingStatus(outcome: CallOutcome): ResultingStatus {
  return outcome === "taken" ? "taken" : "vacant";
}

/** `call.outcome.<value>` — the i18n key for one outcome's button/status label. */
export const outcomeKey = (o: CallOutcome): string => `call.outcome.${o}`;

// TODO(real): POST /api/v1/queue/{queue_item_id}/call-log
export function logCall(input: CallLogInput): Promise<CallLogResult> {
  return Promise.resolve({
    id: `cl-${input.queueItemId}-${Date.now()}`,
    queueItemId: input.queueItemId,
    outcome: input.outcome,
    resultingStatus: resultingStatus(input.outcome),
    loggedAt: new Date().toISOString(),
  });
}
