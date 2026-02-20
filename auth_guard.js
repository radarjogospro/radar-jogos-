// auth_guard.js
// Protege o app (index) exigindo sessão do Supabase.
// - Redireciona para login.html se não houver sessão
// - Mantém "returnTo" para voltar ao app após login
// - Implementa logout (botão #menuLogout) sem mexer no layout

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// IMPORTANTE: mantenha estes valores iguais aos do auth.js
const SUPABASE_URL = "https://khnxyjfxstwjwqjyajwo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imto" +
  "bnh5amZ4c3R3ancxcWpheHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk3OTY1MTcsImV4" +
  "cCI6MjA1NTM3MjUxN30.MxFKTg1-0o66HEkzG_DTXJf2WsSxB_kxwN3FlPRVdl8";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function basePath() {
  // Ex.: "/radar-jogos-/" (GitHub Pages) ou "/" (local)
  const p = window.location.pathname;
  return p.replace(/[^/]*$/, "");
}

const BASE_PATH = basePath();
const LOGIN_PAGE = BASE_PATH + "login.html";

function buildReturnTo() {
  // Mantém o caminho relativo dentro do GitHub Pages
  // Ex.: "/radar-jogos-/?tab=live#x"
  return window.location.pathname + window.location.search + window.location.hash;
}

function goToLogin() {
  const returnTo = encodeURIComponent(buildReturnTo());
  window.location.replace(`${LOGIN_PAGE}?returnTo=${returnTo}`);
}

async function requireAuth() {
  // Se já estiver na tela de login, não bloqueia
  if (window.location.pathname.endsWith("/login.html")) return;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;

    const session = data?.session;
    if (!session) {
      goToLogin();
    }
  } catch (e) {
    // Se falhar por qualquer motivo, manda para login (evita ficar tela vazia)
    goToLogin();
  }
}

function wireLogoutButton() {
  const btn = document.getElementById("menuLogout");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      goToLogin();
    }
  });
}

requireAuth();

document.addEventListener("DOMContentLoaded", () => {
  wireLogoutButton();
});

// Se o usuário sair em outra aba, volta pro login
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session && !window.location.pathname.endsWith("/login.html")) {
    goToLogin();
  }
});
