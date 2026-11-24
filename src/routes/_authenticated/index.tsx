import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { ArchiveForm } from "@/components/threadarch/ArchiveForm";
import { Telemetry } from "@/components/threadarch/Telemetry";
import { Vault } from "@/components/threadarch/Vault";
import { useArchiveJob } from "@/hooks/use-archive-job";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "ThreadArch — Backstage Deck" },
      { name: "description", content: "Scrape a forum thread, resolve its media links and save them to your private vault." },
      { property: "og:title", content: "ThreadArch — Backstage Deck" },
      { property: "og:description", content: "Scrape a forum thread, resolve its media links and save them to your private vault." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Deck,
});

function Deck() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [outDir, setOutDir] = useState("./downloads");
  const onFinished = useCallback(() => void queryClient.invalidateQueries({ queryKey: ["vault"] }), [queryClient]);
  const { job, start } = useArchiveJob(onFinished);
  const pill = job.status === "running" ? "LIVE" : job.status === "completed" ? "DONE" : job.status === "failed" ? "ERR" : "STANDBY";

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="deck-wrap">
      <div className="masthead">
        <div>
          <div className="brand-tag">FORUM MEDIA ARCHIVER // V1</div>
          <h1 className="brand-title">THREAD<span>ARCH</span></h1>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="tour-pill">{pill}</div>
          <button type="button" className="mini-btn mini-btn-muted" onClick={() => void signOut()}>SIGN OUT</button>
        </div>
      </div>
      <ArchiveForm busy={job.status === "running"} outDir={outDir} onOutDirChange={setOutDir} onSubmit={(p) => void start(p)} />
      {job.status !== "idle" && <Telemetry job={job} />}
      <Vault root={outDir} />
    </div>
  );
}
