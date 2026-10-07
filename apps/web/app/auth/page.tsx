"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/auth/${mode}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    if (response.ok) router.push("/dashboard");
    else setError((await response.json().catch(() => ({}))).error ?? "Authentication failed. Check your details and try again.");
  }
  return <main id="main-content" className="game-page"><section className="game-shell"><p className="eyebrow">GAME2WEB ACCOUNT</p><h1>{mode === "login" ? "Sign in" : "Create account"}</h1><div className="auth-form"><label htmlFor="auth-email">Email</label><input id="auth-email" name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /><label htmlFor="auth-password">Password</label><input id="auth-password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="button" type="button" onClick={submit}>{mode === "login" ? "Sign in" : "Create account"}</button></div><p aria-live="polite" role={error ? "alert" : undefined} className="muted">{error}</p><button className="text-link auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Already have an account? Sign in"}</button></section></main>;
}
