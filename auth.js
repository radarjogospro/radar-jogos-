// auth.js — controla login/logout e redirecionamentos
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://wthlxrukcwyqdkeuvjcs.supabase.co";
// Use a anon/public key (JWT)
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0aGx4cnVrY3d5cWRrZXV2amNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3NzIzNTgsImV4cCI6MjA4NzM0ODM1OH0.4Xt5lvcgPbpqbuqJrL75xKYSuOcBDn5aIvnm_p1cn2U";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getBasePath() {
  const p = window.location.pathname;
  const m = p.match(/^(\/[^\/]+\/)/);
  return m ? m[1] : "/";
}

function buildUrl(file, params = {}) {
  const base = getBasePath();
  const url = new URL(base + file, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

// Aceita ?next= (do guard) e também ?returnTo= (caso você use no futuro)
function getNextUrl() {
  const qs = new URLSearchParams(window.location.search);
  const next = qs.get("next") || qs.get("returnTo");
  if (!next) return buildUrl("index.html");
  // Se vier algo absoluto, ignora por segurança
  if (/^https?:\/\//i.test(next)) return buildUrl("index.html");
  // normaliza: se já começa com /, usa o origin + caminho; senão, considera relativo
  if (next.startsWith("/")) return window.location.origin + next;
  return buildUrl(next.replace(/^\.\//, ""));
}

function $(id) { return document.getElementById(id); }
function setMsg(msg, ok = false) {
  const el = $("msg");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = ok ? "#2ecc71" : "#ff6b6b";
}

async function initLoginPage() {
  // Se já está logado, manda pro próximo destino
  const { data } = await supabase.auth.getSession();
  if (data?.session) {
    window.location.replace(getNextUrl());
    return;
  }

  const form = $("loginForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");

    const email = $("email")?.value?.trim();
    const password = $("password")?.value;

    if (!email || !password) {
      setMsg("Preencha e-mail e senha.");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMsg("Falha no login: " + error.message);
      return;
    }

    setMsg("Login OK ✅", true);
    window.location.replace(getNextUrl());
  });
}

async function logout() {
  await supabase.auth.signOut();
  window.location.replace(buildUrl("login.html"));
}

// Exporta para usar no index (botão sair)
window.RD_AUTH = { logout };

initLoginPage();
