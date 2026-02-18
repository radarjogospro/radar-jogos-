import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 1) COLE AQUI:
const SUPABASE_URL = "https://wthlxrukcwyqdkeuvjcs.supabase.co";
const SUPABASE_KEY = "sb_publishable_vfPvj4TOQRPD5GA35QgXVg_wIBIlmZi"; // (NUNCA use service_role/secret)

// ---------- Helpers
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
  return window.location.pathname.replace(/[^/]*$/, "");
}
const BASE_PATH = getBasePath();          // "/radar-jogos-/" ou "/"
const BASE_URL = window.location.origin + BASE_PATH;

let mode = "login"; // "login" | "signup"

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
btnBack.addEventListener("click", () => { window.location.href = "./"; });

// --- Supabase init
function isConfigured() {
  return (
    typeof SUPABASE_URL === "string" &&
    SUPABASE_URL.startsWith("https://") &&
    SUPABASE_URL.includes(".supabase.co") &&
    typeof SUPABASE_KEY === "string" &&
    SUPABASE_KEY.length > 30 &&
    !SUPABASE_URL.includes("SEU-PROJECT-REF") &&
    !SUPABASE_KEY.includes("sb_...")
  );
}

if (!isConfigured()) {
  envPill.textContent = "⚠️ Falta configurar SUPABASE_URL e SUPABASE_KEY no auth.js";
  showMsg(
    "Abra o arquivo auth.js e cole:\n\n- SUPABASE_URL (Project URL)\n- SUPABASE_KEY (Publishable/anon)\n\nDepois suba no GitHub e recarregue.",
    "warn"
  );
}

const supabase = isConfigured() ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

if (supabase) envPill.textContent = "Supabase conectado ✅";

// Se já estiver logado, volta pro app
(async function boot() {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) window.location.replace("./");
  } catch {}
})();

// --- Submit
form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  const password = passEl.value || "";
  const password2 = pass2El.value || "";

  if (!email || !password) return showMsg("Preencha e-mail e senha.", "warn");

  setBusy(true);
  try {
    if (mode === "signup") {
      if (password.length < 6) return showMsg("Senha muito curta (mínimo 6).", "warn");
      if (password !== password2) return showMsg("As senhas não conferem.", "warn");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: BASE_URL,
        },
      });

      if (error) return showMsg(error.message, "warn");

      // Se confirmação por email estiver ativa, o session pode vir null
      if (!data?.session) {
        showMsg("Conta criada! Verifique seu e-mail para confirmar e depois faça login.", "ok");
      } else {
        showMsg("Conta criada e logada ✅ Indo pro app…", "ok");
        setTimeout(() => window.location.replace("./"), 600);
      }
      return;
    }

    // login
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return showMsg(error.message, "warn");
    if (data?.session) {
      showMsg("Logado ✅ Indo pro app…", "ok");
      setTimeout(() => window.location.replace("./"), 400);
    }
  } catch (e) {
    showMsg(String(e?.message || e), "warn");
  } finally {
    setBusy(false);
  }
});

// --- Forgot password
forgot.addEventListener("click", async () => {
  clearMsg();
  if (!supabase) return;

  const email = (emailEl.value || "").trim();
  if (!email) return showMsg("Digite seu e-mail acima para recuperar a senha.", "warn");

  setBusy(true);
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: BASE_URL,
    });
    if (error) return showMsg(error.message, "warn");
    showMsg("Enviei um link de recuperação para seu e-mail.", "ok");
  } catch (e) {
    showMsg(String(e?.message || e), "warn");
  } finally {
    setBusy(false);
  }
});
