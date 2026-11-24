import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LovableMark } from "@lovable.dev/cloud-auth-js/react";
import { useEffect, useState, type FormEvent } from "react";

import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ThreadArch" },
      { name: "description", content: "Sign in to open your private ThreadArch media vault." },
      { property: "og:title", content: "Sign in — ThreadArch" },
      { property: "og:description", content: "Sign in to open your private ThreadArch media vault." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive && data.session) void navigate({ to: "/", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void navigate({ to: "/", replace: true });
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNote("");
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (err) throw err;
        if (!data.session) setNote("Check your email to confirm your account, then sign in.");
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (err) throw err;
        setNote("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError((err as Error).message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: "google" | "lovable") {
    setError("");
    const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: window.location.origin });
    if (result.error) setError(result.error.message || "Sign-in failed");
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
        <div className="tour-pill">LOCKED</div>
      </div>

      <div className="deck-card">
        {mode !== "forgot" && (
          <div className="tab-switch" role="tablist">
            <button type="button" data-active={mode === "signin"} onClick={() => setMode("signin")}>
              SIGN IN
            </button>
            <button type="button" data-active={mode === "signup"} onClick={() => setMode("signup")}>
              CREATE ACCOUNT
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-3">
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="deck-input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mode !== "forgot" && (
            <div className="mt-3">
              <div className="label-row">
                <label className="field-label" htmlFor="password">
                  Password
                </label>
                {mode === "signin" && (
                  <button type="button" className="text-link" onClick={() => setMode("forgot")}>
                    FORGOT?
                  </button>
                )}
              </div>
              <input
                id="password"
                className="deck-input"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {error && <div className="alert-box">{error}</div>}
          {note && <div className="note-box">{note}</div>}
          <button className="drop-btn" type="submit" disabled={busy}>
            {mode === "signin" ? "ENTER DECK" : mode === "signup" ? "CREATE ACCOUNT" : "SEND RESET LINK"}
          </button>
          {mode === "forgot" && (
            <div className="mt-3 text-center">
              <button type="button" className="text-link" onClick={() => setMode("signin")}>
                BACK TO SIGN IN
              </button>
            </div>
          )}
        </form>

        {mode !== "forgot" && (
          <>
            <div className="or-rule">OR</div>
            <div className="flex flex-col gap-2">
              <button type="button" className="ghost-btn" onClick={() => void social("google")}>
                <GoogleMark />
                Continue with Google
              </button>
              <button type="button" className="ghost-btn" onClick={() => void social("lovable")}>
                <LovableMark />
                Continue with Lovable
              </button>
            </div>
          </>
        )}
      </div>
      <p className="hint-note mt-4 text-center">Your vault is private to your account.</p>
    </div>
  );
}
