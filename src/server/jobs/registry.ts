// Jobbtyperna: send_message (utskick) och röstinspelningens jobb (transkribering, utkast och gallring – voice.ts).
// Senare (docs/UTSKICK.md): närvaropåminnelser, veckorapport, progressionsbevakning.
import { sendMessageJob, type SenderDeps } from "../notify/sender";
import { SEND_MESSAGE } from "../notify/types";
import type { JobHandler } from "./runner";
import { voiceJobHandlers, type VoiceDeps } from "./voice";

/** Det jobben behöver. Varje jobbtyp får sin del. voice byggs först när ett röstjobb körs. */
export type JobDeps = { notify: SenderDeps } & VoiceDeps;

export const JOB_HANDLERS: Readonly<Record<string, JobHandler<JobDeps>>> = {
  [SEND_MESSAGE]: {
    run: (job, d) => sendMessageJob.run(job, d.notify),
    onGiveUp: (job, reason, d) => sendMessageJob.onGiveUp(job, reason, d.notify),
  },
  ...voiceJobHandlers<JobDeps>(),
};
