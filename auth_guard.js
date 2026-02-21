// auth_guard.js — bloqueia o app até existir sessão válida do Supabase
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://mpgddtgntrqcixhkczrs.supabase.co";
// IMPORTANTE: use a "anon/public key" (JWT) do Supabase (não é service_role).
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wZ2RkdGdudHJxY2l4aGtjenJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDEwMDg0ODQsImV4cCI6MjA1NjU4NDQ4NH0.7K2l6j2hC69QwsgAjp0uYNEdWtnbEw4OfwH9zjvYhGg";

const LOGIN_FILE = "login.html";
const AUTH_REQUIRED = true;

// Detecta a “pasta base” do GitHub Pages para este repo (ex: /radar-jogos-/)
function getBasePath() {
  const p = window.location.pathname;
  // ex.: /radar-jogos-/algo -> base = /radar-jogos-/
  const m = p.match(/^(\/[^\/]+\/)/);
  return m ? m[1] : "/";
}

function buildUrl(file, params = {}) {
  const base = getBasePath();
  const url = new URL(base + file, window.location.origin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function main() {
  if (!AUTH_REQUIRED) return;

  // Não bloqueia a própria tela de login
  if (window.location.pathname.endsWith("/" + LOGIN_FILE)) return;

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getSession();

  const isLogged = !!data?.session && !error;

  if (!isLogged) {
    const next = window.location.pathname + window.location.search + window.location.hash;
    window.location.replace(buildUrl(LOGIN_FILE, { next }));
  }
}

main().catch(() => {
  // Se der erro, por segurança manda pro login
  const next = window.location.pathname + window.location.search + window.location.hash;
  window.location.replace(buildUrl(LOGIN_FILE, { next }));
});
