import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1) COLE AQUI:
const SUPABASE_URL = "https://wthlxrukcwyqdkeuvjcs.supabase.co";
const SUPABASE_KEY = "sb_publishable_vfPvj4TOQRPD5GA35QgXVg_wIBIlmZi"; // (NUNCA use service_role/secret)

// --------- Helpers
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
  pass2El.disabled = busy;
  forgot.style.pointerEvents = busy ? "none" : "auto";
}

// Base do seu app (IMPORTANTE por causa do /radar-jogos-/)
function getBasePath() {
  // Ex: /radar-jogos-/login.html  -> /radar-jogos-/
  return window.location.pathname.replace(/[^/]*$/, "");
}
const BASE_PATH = getBasePath(); // "/radar-jogos-/"
const BASE_URL = window.location.origin + BASE_PATH;

// --------- Tabs
let mode = "login"; // login | signup

function setMode(next) {
  mode = next;
  clearMsg();

  const isSignup = mode === "signup";
  tabLogin.classList.toggle("active", !isSignup);
  tabSignup.classList.toggle("active", isSignup);
  signupExtra.style.display = isSignup ? "block" : "none";
  btnSubmit.textContent = isSignup ? "Criar conta" : "Entrar";

  pass2El.required = isSignup;
  pass2El.value = "";
}
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

btnBack.addEventListener("click", () => {
  window.location.href = "./";
});

// --------- Supabase init
function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_URL.includes(".supabase.co") &&
    typeof SUPABASE_KEY === "string" &&
    SUPABASE_KEY.length > 30 &&
    !SUPABASE_URL.includes("SEU-PROJECT-REF") &&
    !SUPABASE_KEY.includes("SUA_")
  );
}

if (!isConfigured()) {
  envPill.textContent = "⚠️ Configure SUPABASE_URL e SUPABASE_KEY no auth.js";
  showMsg(
    "Falta configurar:\n\n- SUPABASE_URL (Project URL)\n- SUPABASE_KEY (Publishable/anon)\n\nDepois recarregue a página.",
    "warn"
  );
}

const supabase = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (supabase) {
  envPill.textContent = "Supabase conectado ✅";
}

// Se já estiver logado, volta pro app
(async function boot() {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) window.location.replace("./");
  } catch {}
})();

// --------- Submit
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  const password = passEl.value || "";
  const password2 = pass2El.value || "";

  if (!email || !password) return showMsg("Preencha e-mail e senha.", "warn");

  if (mode === "signup") {
    if (password.length < 6) return showMsg("Senha muito curta (mínimo 6).", "warn");
    if (password !== password2) return showMsg("As senhas não conferem.", "warn");
  }

  setBusy(true);
  try {
    if (mode === "login") {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (data?.session) {
        showMsg("Login realizado! Entrando…", "ok");
        window.location.replace("./");
        return;
      }
      showMsg("Login feito, mas sem sessão. Tente novamente.", "warn");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: BASE_URL }, // <- importante
      });
      if (error) throw error;

      if (data?.session) {
        showMsg("Conta criada e logada! Entrando…", "ok");
        window.location.replace("./");
        return;
      }

      showMsg(
        "Conta criada!\n\nSe a confirmação por e-mail estiver ATIVA, confirme no e-mail e depois volte para entrar.\nSe você desativou a confirmação, tente entrar agora.",
        "ok"
      );
      setMode("login");
    }
  } catch (err) {
    const msg = err?.message || err?.error_description || String(err);
    const lower = msg.toLowerCase();

    if (lower.includes("invalid login credentials")) showMsg("E-mail ou senha incorretos.", "bad");
    else if (lower.includes("email not confirmed")) showMsg("Confirme seu e-mail e tente novamente.", "warn");
    else if (lower.includes("already registered")) { showMsg("Esse e-mail já existe. Tente entrar.", "warn"); setMode("login"); }
    else showMsg("Erro: " + msg, "bad");
  } finally {
    setBusy(false);
  }
});

// --------- Reset senha
forgot.addEventListener("click", async (ev) => {
  ev.preventDefault();
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  if (!email) return showMsg("Digite seu e-mail acima e toque em “Esqueci minha senha”.", "warn");

  setBusy(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: BASE_URL + "login.html", // <- importante
    });
    if (error) throw error;
    showMsg("Se existir conta com esse e-mail, você receberá um link para redefinir a senha.", "ok");
  } catch (err) {
    const msg = err?.message || err?.error_description || String(err);
    showMsg("Erro: " + msg, "bad");
  } finally {
    setBusy(false);
  }
});
