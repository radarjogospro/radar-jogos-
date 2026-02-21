// auth.js - Radar PRO (GitHub Pages) | Login obrigatório via Supabase
// Objetivo: não travar em "Conectando...", funcionar no celular e impedir bypass pro Radar sem login.

const SUPABASE_URL = "https://wthlxrukcwyqdkeuvjcs.supabase.co";
const SUPABASE_KEY = "sb_publishable_vfPvj4TOQRPD5GA35QgXVg_wIBIlmZi";
const SDK_TIMEOUT_MS = 8000;

let supabase = null;

const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);

function setPill(text, kind = "warn") {
  const pill = byId("envPill");
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove("ok", "warn", "err");
  pill.classList.add(kind);
}

function setMsg(text = "", kind = "warn") {
  const msg = byId("msg");
  if (!msg) return;
  if (!text) {
    msg.style.display = "none";
    msg.textContent = "";
    msg.classList.remove("ok", "warn", "err");
    return;
  }
  msg.style.display = "block";
  msg.textContent = text;
  msg.classList.remove("ok", "warn", "err");
  msg.classList.add(kind);
}

function setDisabled(disabled) {
  const ids = ["email", "password", "password2", "btnSubmit", "tabLogin", "tabSignup", "forgot"];
  ids.forEach((id) => {
    const el = byId(id);
    if (el) el.disabled = !!disabled;
  });
}

function isConfigured() {
  return (
    !!SUPABASE_URL &&
    !!SUPABASE_KEY &&
    !SUPABASE_URL.includes("COLOQUE") &&
    !SUPABASE_KEY.includes("COLOQUE")
  );
}

async function importWithTimeout(url, timeoutMs) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), timeoutMs)
  );
  return Promise.race([import(url), timeout]);
}

async function loadSupabaseSDK() {
  const candidates = [
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm",
    "https://esm.sh/@supabase/supabase-js@2",
  ];
  let lastErr = null;
  for (const u of candidates) {
    try {
      return await importWithTimeout(u, SDK_TIMEOUT_MS);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Falha ao carregar SDK Supabase");
}

async function ensureSupabase() {
  if (supabase) return supabase;

  // Impede bypass mesmo se estiver visível no HTML
  const homeLink = byId("home");
  if (homeLink) homeLink.style.display = "none";

  if (!isConfigured()) {
    setPill("Supabase não configurado", "err");
    setMsg("Falta configurar SUPABASE_URL e SUPABASE_KEY no auth.js.", "err");
    return null;
  }

  setPill("Conectando ao Supabase...", "warn");
  setDisabled(true);

  try {
    const { createClient } = await loadSupabaseSDK();
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });

    // Ping rápido ao Auth pra não ficar enganando o usuário
    const { error } = await supabase.auth.getSession();
    if (error) {
      setPill("Supabase conectado (com aviso)", "warn");
      setMsg("Conectei, mas o Auth respondeu com aviso. Tente novamente.", "warn");
    } else {
      setPill("Supabase conectado", "ok");
      setMsg("", "ok");
    }

    setDisabled(false);
    return supabase;
  } catch (e) {
    setPill("Falha ao conectar", "err");
    setMsg(
      "Não consegui carregar/conectar no Supabase. Pode ser internet/CDN bloqueado. " +
        "Tente em outra rede ou aguarde e tente novamente.",
      "err"
    );
    setDisabled(false);
    return null;
  }
}

function isSignupMode() {
  return byId("tabSignup")?.classList.contains("active");
}

function setMode(mode) {
  const tabLogin = byId("tabLogin");
  const tabSignup = byId("tabSignup");
  const signupExtra = byId("signupExtra");
  const btn = byId("btnSubmit");

  if (!tabLogin || !tabSignup || !signupExtra || !btn) return;

  if (mode === "signup") {
    tabSignup.classList.add("active");
    tabLogin.classList.remove("active");
    signupExtra.style.display = "block";
    btn.textContent = "Criar conta";
  } else {
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
    signupExtra.style.display = "none";
    btn.textContent = "Entrar";
  }
}

async function doLogin(email, password) {
  const client = await ensureSupabase();
  if (!client) return;

  setMsg("", "ok");
  setPill("Entrando...", "warn");
  setDisabled(true);

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    setPill("Falha no login", "err");
    setMsg(error.message || "Falha no login.", "err");
    setDisabled(false);
    return;
  }

  // Sessão ok → entra no Radar
  setPill("Logado ✓", "ok");
  setMsg("Login feito! Abrindo o Radar…", "ok");

  // Pequeno delay só pra mostrar feedback (não é obrigatório)
  setTimeout(() => {
    window.location.href = "./";
  }, 300);
}

async function doSignup(email, password, password2) {
  const client = await ensureSupabase();
  if (!client) return;

  if (password !== password2) {
    setMsg("As senhas não conferem.", "warn");
    return;
  }
  if (password.length < 6) {
    setMsg("A senha precisa ter pelo menos 6 caracteres.", "warn");
    return;
  }

  setMsg("", "ok");
  setPill("Criando conta...", "warn");
  setDisabled(true);

  const { data, error } = await client.auth.signUp({ email, password });

  if (error) {
    setPill("Falha ao criar", "err");
    setMsg(error.message || "Falha ao criar conta.", "err");
    setDisabled(false);
    return;
  }

  // Se seu Supabase exigir confirmação por e-mail, data.session vem null.
  if (data?.session) {
    setPill("Logado ✓", "ok");
    setMsg("Conta criada e logado! Abrindo o Radar…", "ok");
    setTimeout(() => (window.location.href = "./"), 300);
  } else {
    setPill("Conta criada", "ok");
    setMsg("Conta criada. Verifique seu e-mail para confirmar (se estiver habilitado).", "warn");
    setDisabled(false);
  }
}

async function doForgot(email) {
  const client = await ensureSupabase();
  if (!client) return;

  if (!email) {
    setMsg("Digite seu e-mail primeiro.", "warn");
    return;
  }

  setPill("Enviando e-mail...", "warn");
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname.replace("login.html", "login.html"),
  });

  if (error) {
    setPill("Erro", "err");
    setMsg(error.message || "Não foi possível enviar o e-mail.", "err");
    return;
  }

  setPill("OK", "ok");
  setMsg("Se esse e-mail existir, enviamos um link de recuperação.", "ok");
}

function wireUI() {
  // Tabs
  byId("tabLogin")?.addEventListener("click", () => setMode("login"));
  byId("tabSignup")?.addEventListener("click", () => setMode("signup"));

  // Default
  setMode("login");

  // Submit
  const form = byId("form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = (byId("email")?.value || "").trim();
    const password = byId("password")?.value || "";
    const password2 = byId("password2")?.value || "";

    if (!email || !password) {
      setMsg("Preencha e-mail e senha.", "warn");
      return;
    }

    if (isSignupMode()) await doSignup(email, password, password2);
    else await doLogin(email, password);
  });

  byId("btnSubmit")?.addEventListener("click", (e) => {
    // deixa o handler do form resolver
    e.preventDefault();
    form?.requestSubmit?.();
  });

  byId("forgot")?.addEventListener("click", (e) => {
    e.preventDefault();
    const email = (byId("email")?.value || "").trim();
    doForgot(email);
  });

  // Conecta sem travar a UI
  ensureSupabase();
}

document.addEventListener("DOMContentLoaded", wireUI);
