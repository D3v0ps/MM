// Jobbtyperna. Nu: send_message. Senare (docs/UTSKICK.md): närvaropåminnelser, veckorapport, progressionsbevakning, gallring.
import { sendMessageJob, type SenderDeps } from "../notify/sender";
import { SEND_MESSAGE } from "../notify/types";
import type { JobHandler } from "./runner";

/** Det jobben behöver. Varje jobbtyp får sin del. */
export type JobDeps = { notify: SenderDeps };

export const JOB_HANDLERS: Readonly<Record<string, JobHandler<JobDeps>>> = {
  [SEND_MESSAGE]: {
    run: (job, d) => sendMessageJob.run(job, d.notify),
    onGiveUp: (job, reason, d) => sendMessageJob.onGiveUp(job, reason, d.notify),
  },
};
