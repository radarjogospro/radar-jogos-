// auth.js - Radar PRO (GitHub Pages) - Login obrigatório via Supabase Auth (Email/Senha)
// Ajustado para os IDs do login.html: #form, #email, #password, #password2, #msg, #tabLogin, #tabSignup.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://mpgddtgntrqcixhkczrs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wZ2RkdGdudHJxY2l4aGtjenJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwMDg0ODQsImV4cCI6MjA1NjU4NDQ4NH0.7K2l6j2hC69QwsgAjp0uYNEdWtnbEw4OfwH9zjvYhGg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// --- helpers de URL (funciona em GitHub Pages com subpasta /radar-jogos-/) ---
function getBasePath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}/` : "/";
}
function buildUrl(file) {
  const base = getBasePath();
  const clean = String(file || "").replace(/^\//, "");
  return `${window.location.origin}${base}${clean}`;
}
function getNextUrl() {
  const u = new URL(window.location.href);
  return u.searchParams.get("next") || buildUrl("index.html");
}
function setMsg(text, type = "info") {
  const el = document.getElementById("msg");
  if (!el) return;
  el.textContent = text || "";
  el.dataset.type = type;
  el.style.opacity = text ? "1" : "0";
}

document.addEventListener("DOMContentLoaded", async () => {
  const envPill = document.getElementById("envPill");
  if (envPill) envPill.textContent = "Supabase conectado ✅";

  const form = document.getElementById("form");
  const emailEl = document.getElementById("email");
  const passEl = document.getElementById("password");
  const pass2El = document.getElementById("password2");
  const btnSubmit = document.getElementById("btnSubmit");
  const tabLogin = document.getElementById("tabLogin");
  const tabSignup = document.getElementById("tabSignup");
  const signupExtra = document.getElementById("signupExtra");
  const forgot = document.getElementById("forgot");

  // Se já estiver logado, manda direto pro app
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      window.location.replace(getNextUrl());
      return;
    }
  } catch (_) {}

  let mode = "login"; // login | signup

  function applyMode() {
    const isSignup = mode === "signup";
    if (signupExtra) signupExtra.style.display = isSignup ? "block" : "none";
    tabLogin?.classList.toggle("active", !isSignup);
    tabSignup?.classList.toggle("active", isSignup);
    if (btnSubmit) btnSubmit.textContent = isSignup ? "Criar conta" : "Entrar";
    setMsg("");
  }

  tabLogin?.addEventListener("click", () => { mode = "login"; applyMode(); });
  tabSignup?.addEventListener("click", () => { mode = "signup"; applyMode(); });

  forgot?.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = (emailEl?.value || "").trim();
    if (!email) return setMsg("Digite seu e-mail para receber o link de recuperação.", "warn");
    setMsg("Enviando link de recuperação...", "info");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: buildUrl("login.html") });
    if (error) return setMsg(`Erro: ${error.message}`, "error");
    setMsg("Link de recuperação enviado! Verifique seu e-mail.", "ok");
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (emailEl?.value || "").trim();
    const password = passEl?.value || "";
    const password2 = pass2El?.value || "";

    if (!email || !password) return setMsg("Preencha e-mail e senha.", "warn");

    if (btnSubmit) btnSubmit.disabled = true;

    try {
      if (mode === "signup") {
        if (password.length < 6) return setMsg("A senha precisa ter pelo menos 6 caracteres.", "warn");
        if (password !== password2) return setMsg("As senhas não conferem.", "warn");

        setMsg("Criando conta...", "info");
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return setMsg(`Erro: ${error.message}`, "error");

        if (!data?.session) {
          setMsg("Conta criada! Confirme no seu e-mail e depois faça login.", "ok");
          mode = "login";
          applyMode();
          return;
        }

        setMsg("Conta criada e logado ✅ Redirecionando...", "ok");
        window.location.replace(getNextUrl());
      } else {
        setMsg("Entrando...", "info");
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return setMsg(`Erro: ${error.message}`, "error");
        if (!data?.session) return setMsg("Não foi possível iniciar sessão. Tente novamente.", "error");

        setMsg("Logado ✅ Redirecionando...", "ok");
        window.location.replace(getNextUrl());
      }
    } catch (err) {
      setMsg(`Erro inesperado: ${err?.message || err}`, "error");
    } finally {
      if (btnSubmit) btnSubmit.disabled = false;
    }
  });

  applyMode();
});
