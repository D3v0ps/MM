// Jobbtyperna: send_message (utskick), röstinspelningens jobb (transkribering, utkast och gallring – voice.ts),
// rapportutkasten (report_schedule – reports.ts) och timjobben attachments_retention och auth_cleanup (attachments.ts).
// Senare (docs/UTSKICK.md): närvaropåminnelser, progressionsbevakning.
import { sendMessageJob, type SenderDeps } from "../notify/sender";
import { attachmentJobHandlers, type AttachmentJobDeps } from "./attachments";
import { SEND_MESSAGE } from "../notify/types";
import { REPORT_SCHEDULE_JOB, reportScheduleHandler, type ReportDeps } from "./reports";
import type { JobHandler } from "./runner";
import { voiceJobHandlers, type VoiceDeps } from "./voice";

/** Det jobben behöver. Varje jobbtyp får sin del. voice och system byggs först när ett sådant jobb körs. */
export type JobDeps = { notify: SenderDeps } & VoiceDeps & ReportDeps & AttachmentJobDeps;

export const JOB_HANDLERS: Readonly<Record<string, JobHandler<JobDeps>>> = {
  [SEND_MESSAGE]: {
    run: (job, d) => sendMessageJob.run(job, d.notify),
    onGiveUp: (job, reason, d) => sendMessageJob.onGiveUp(job, reason, d.notify),
  },
  ...voiceJobHandlers<JobDeps>(),
  [REPORT_SCHEDULE_JOB]: reportScheduleHandler<JobDeps>(),
  // Bilagornas gallring och städningen av Auth-användare utan profil (beslut 2026-10-07).
  ...attachmentJobHandlers<JobDeps>(),
};
