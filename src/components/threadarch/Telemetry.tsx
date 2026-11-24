import { jobProgress, type JobState } from "@/hooks/use-archive-job";
import { useEffect, useRef } from "react";

const tagClass = (t: string) =>
  t === "ERR" ? "log-tag log-tag-err" : t === "DONE" || t === "OK" || t === "SAVE" ? "log-tag log-tag-ok" : t === "WARN" || t === "SLOW" ? "log-tag log-tag-warn" : "log-tag";

export function Telemetry({ job }: { job: JobState }) {
  const pct = jobProgress(job);
  const con = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (con.current) con.current.scrollTop = con.current.scrollHeight;
  }, [job.logs.length]);
  return (
    <div className="deck-card">
      <div className="meter-head">
        <span className="stage-badge">{job.stage}</span>
        <span>{pct}%</span>
        <span>{job.elapsed}</span>
      </div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
      <div className="thread-line">{job.threadTitle ? `Thread: ${job.threadTitle} -> ${job.outDir}` : "Scanning thread..."}</div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        <div className="stat"><div className="stat-val">{job.resolvedTotal}</div><div className="stat-lbl">Resolved</div></div>
        <div className="stat"><div className="stat-val">{job.downloaded}</div><div className="stat-lbl">Saved</div></div>
        <div className="stat"><div className="stat-val">{job.skipped}</div><div className="stat-lbl">Skipped</div></div>
        <div className="stat"><div className="stat-val stat-val-hot">{job.errors}</div><div className="stat-lbl">Errors</div></div>
      </div>
      <div className="deck-console" ref={con}>
        {job.logs.map((r, i) => (
          <div key={i} className="log-row"><span className="log-t">{r.time}</span><span className={tagClass(r.tag)}>[{r.tag}]</span><span>{r.msg}</span></div>
        ))}
      </div>
    </div>
  );
}
