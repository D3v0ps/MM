// Jobbtyperna: send_message (utskick), röstinspelningens jobb (transkribering, utkast och gallring – voice.ts) och
// rapportutkasten (report_schedule – reports.ts).
// Senare (docs/UTSKICK.md): närvaropåminnelser, progressionsbevakning.
import { sendMessageJob, type SenderDeps } from "../notify/sender";
import { SEND_MESSAGE } from "../notify/types";
import { REPORT_SCHEDULE_JOB, reportScheduleHandler, type ReportDeps } from "./reports";
import type { JobHandler } from "./runner";
import { voiceJobHandlers, type VoiceDeps } from "./voice";

/** Det jobben behöver. Varje jobbtyp får sin del. voice och system byggs först när ett sådant jobb körs. */
export type JobDeps = { notify: SenderDeps } & VoiceDeps & ReportDeps;

export const JOB_HANDLERS: Readonly<Record<string, JobHandler<JobDeps>>> = {
  [SEND_MESSAGE]: {
    run: (job, d) => sendMessageJob.run(job, d.notify),
    onGiveUp: (job, reason, d) => sendMessageJob.onGiveUp(job, reason, d.notify),
  },
  ...voiceJobHandlers<JobDeps>(),
  [REPORT_SCHEDULE_JOB]: reportScheduleHandler<JobDeps>(),
};
