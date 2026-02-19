// Radar PRO Auth (Supabase) — com returnTo (volta para a tela que o usuário queria)
// 1) Cole suas chaves aqui (APENAS publishable/anon public; NUNCA use secret key no site).
// 2) Suba login.html + auth.js no GitHub junto do seu index.html.
// 3) Abra: https://radarjogospro.github.io/radar-jogos-/login.html

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://wthlxrukcwyqdkeuvjcs.supabase.co";        // exemplo: https://xxxx.supabase.co
const SUPABASE_KEY = "sb_publishable_vfPvj4TOQRPD5GA35QgXVg_wIBIlmZi";    // sb_publishable_...

// --------- UI helpers
const $ = (id) => document.getElementById(id);
const envPill = $("envPill");
const tabLogin = $("tabLogin");
const tabSignup = $("tabSignup");
const signupExtra = $("signupExtra");
const form = $("form");
const emailEl = $("email");
const passEl = $("password");
const pass2El = $("password2");
const btnSubmit = $("btnSubmit");
const btnBack = $("btnBack");
const msgEl = $("msg");
const forgot = $("forgot");

function showMsg(text, kind = "") {
  msgEl.style.display = "block";
  msgEl.className = "msg" + (kind ? " " + kind : "");
  msgEl.textContent = text;
}
function clearMsg() {
  msgEl.style.display = "none";
  msgEl.textContent = "";
  msgEl.className = "msg";
}
function setBusy(busy) {
  btnSubmit.disabled = busy;
  tabLogin.disabled = busy;
  tabSignup.disabled = busy;
  emailEl.disabled = busy;
  passEl.disabled = busy;
  if (pass2El) pass2El.disabled = busy;
  forgot.style.pointerEvents = busy ? "none" : "auto";
}

let mode = "login"; // login | signup

function setMode(next) {
  mode = next;
  clearMsg();

  const isSignup = mode === "signup";
  tabLogin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active", isSignup);
  signupExtra.style.display = isSignup ? "block" : "none";
  btnSubmit.textContent = isSignup ? "Criar conta" : "Entrar";

  // password2 only required in signup
  pass2El.required = isSignup;
  pass2El.value = "";
}
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

function basePath() {
  // Ex: /radar-jogos-/login.html -> /radar-jogos-/
  return window.location.pathname.replace(/[^/]*$/, "");
}
const BASE_PATH = basePath();
const APP_HOME = BASE_PATH; // "./" mas resolvido
btnBack.addEventListener("click", () => {
  window.location.href = APP_HOME;
});

// --------- returnTo support
function getReturnTo() {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("returnTo");
  if (!raw) return null;

  // Só permite voltar para o mesmo domínio (segurança).
  try {
    const u = new URL(raw, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return u.href;
  } catch {
    return null;
  }
}
function goAfterLogin() {
  const rt = getReturnTo();
  window.location.replace(rt || APP_HOME);
}

// --------- Supabase init
function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_URL.includes(".supabase.co") &&
    typeof SUPABASE_KEY === "string" &&
    SUPABASE_KEY.length > 30 &&
    !SUPABASE_URL.includes("COLE_AQUI") &&
    !SUPABASE_KEY.includes("COLE_AQUI")
  );
}

if (!isConfigured()) {
  envPill.textContent = "⚠️ Falta configurar SUPABASE_URL e SUPABASE_KEY no auth.js";
  envPill.style.color = "rgba(255,255,255,0.85)";
  showMsg(
    "Abra o arquivo auth.js e cole:\n\n- SUPABASE_URL (Project URL)\n- SUPABASE_KEY (Publishable key)\n\nDepois suba no GitHub e recarregue.",
    "warn"
  );
} else {
  envPill.textContent = "Supabase conectado ✅";
}

const supabase = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Se já estiver logado, volta pro app (ou returnTo)
(async function boot() {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) {
      goAfterLogin();
    }
  } catch (e) {
    // ignore
  }
})();

// --------- Actions
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  const password = passEl.value || "";
  const password2 = pass2El.value || "";

  if (!email || !password) {
    showMsg("Preencha e-mail e senha.", "warn");
    return;
  }

  if (mode === "signup") {
    if (password.length < 6) {
      showMsg("Senha muito curta. Use pelo menos 6 caracteres.", "warn");
      return;
    }
    if (password !== password2) {
      showMsg("As senhas não conferem.", "warn");
      return;
    }
  }

  setBusy(true);
  try {
    if (mode === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.session) {
        showMsg("Login realizado! Entrando…", "ok");
        goAfterLogin();
        return;
      }
      showMsg("Login feito, mas sem sessão. Tente novamente.", "warn");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin + APP_HOME,
        },
      });
      if (error) throw error;

      // Se confirmação por email estiver desligada, já entra
      if (data?.session) {
        showMsg("Conta criada e logada! Entrando…", "ok");
        goAfterLogin();
        return;
      }

      showMsg(
        "Conta criada!\n\nSe a confirmação por e-mail estiver ATIVA, verifique sua caixa de entrada para confirmar e depois volte para entrar.\n\nSe você desativou a confirmação, tente entrar agora.",
        "ok"
      );
      setMode("login");
    }
  } catch (err) {
    const msg = (err && (err.message || err.error_description)) ? (err.message || err.error_description) : String(err);
    // mensagens comuns
    if (msg.toLowerCase().includes("invalid login credentials")) {
      showMsg("E-mail ou senha incorretos.", "bad");
    } else if (msg.toLowerCase().includes("email not confirmed")) {
      showMsg("Seu e-mail ainda não foi confirmado. Confirme no e-mail e tente novamente.", "warn");
    } else if (msg.toLowerCase().includes("user already registered") || msg.toLowerCase().includes("already registered")) {
      showMsg("Esse e-mail já está cadastrado. Tente entrar.", "warn");
      setMode("login");
    } else {
      showMsg("Erro: " + msg, "bad");
    }
  } finally {
    setBusy(false);
  }
});

forgot.addEventListener("click", async (ev) => {
  ev.preventDefault();
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  if (!email) {
    showMsg("Digite seu e-mail acima e toque em “Esqueci minha senha”.", "warn");
    return;
  }

  setBusy(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + BASE_PATH + "login.html",
    });
    if (error) throw error;
    showMsg("Pronto! Se existir conta com esse e-mail, você receberá um link para redefinir a senha.", "ok");
  } catch (err) {
    const msg = (err && (err.message || err.error_description)) ? (err.message || err.error_description) : String(err);
    showMsg("Erro: " + msg, "bad");
  } finally {
    setBusy(false);
  }
});
