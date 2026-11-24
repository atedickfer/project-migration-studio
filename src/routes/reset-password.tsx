import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password — ThreadArch" },
      { name: "description", content: "Choose a new password for your ThreadArch account." },
      { property: "og:title", content: "Reset password — ThreadArch" },
      { property: "og:description", content: "Choose a new password for your ThreadArch account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isRecovery = window.location.hash.includes("type=recovery");
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session && isRecovery) setReady(true);
    });
    if (isRecovery) setReady(true);
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    void navigate({ to: "/", replace: true });
  }

  return (
    <div className="deck-wrap">
      <div className="masthead">
        <div>
          <div className="brand-tag">FORUM MEDIA ARCHIVER // V1</div>
          <h1 className="brand-title">
            THREAD<span>ARCH</span>
          </h1>
        </div>
        <div className="tour-pill">RESET</div>
      </div>
      <form className="deck-card" onSubmit={onSubmit}>
        {!ready ? (
          <div className="hint-note">Open this page from the reset link in your email.</div>
        ) : (
          <>
            <label className="field-label" htmlFor="new-password">
              New password
            </label>
            <input
              id="new-password"
              className="deck-input"
              type="password"
              autoComplete="new-password"
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && <div className="alert-box">{error}</div>}
            <button className="drop-btn" type="submit" disabled={busy}>
              SAVE PASSWORD
            </button>
          </>
        )}
      </form>
    </div>
  );
}
