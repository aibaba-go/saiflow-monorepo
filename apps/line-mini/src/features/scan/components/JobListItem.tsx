import { useT } from "../../../i18n";
import { formatBangkokDateTime } from "../../../utils/format";
import type { JobOut } from "../jobs";
import s from "./JobListItem.module.css";
import { StatusChip } from "./StatusChip";

/** main `JobListItem.vue`. main's meta line also counts tables; our job list has no table
 * count, so it shows the pages and the Bangkok time. */
export function JobListItem({ job, onOpen }: { job: JobOut; onOpen(job: JobOut): void }) {
  const t = useT();
  const pages =
    job.page_count === 1 ? t("home.pending.pageOne") : t("home.pending.pageMany", { n: job.page_count });
  const time = formatBangkokDateTime(job.created_at).slice(11);
  return (
    <button type="button" className={s.card} data-job={job.id} onClick={() => onOpen(job)}>
      <div className={s.icon}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A66F7" strokeWidth="2" strokeLinecap="round">
          <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      <div className={s.main}>
        <div className={s.name}>{job.file_name || "—"}</div>
        <div className={s.meta}>
          {pages} · {time}
        </div>
        {job.template_name && <div className={s.template}>{job.template_name}</div>}
      </div>
      <StatusChip stage={job.stage} />
    </button>
  );
}
