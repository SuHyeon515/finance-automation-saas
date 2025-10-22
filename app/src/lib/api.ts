// @ts-nocheck
import { supabase } from "@/lib/supabaseClient"; // ✅ 기존 클라이언트 import

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "https://finance-automation-saas.onrender.com";

// ✅ Supabase 세션에서 토큰 안전하게 읽기
async function getToken() {
  if (typeof window === "undefined") return null;

  try {
    const session = (await supabase.auth.getSession()).data.session;

    // ✅ fallback: localStorage 직접 접근
    if (!session) {
      const raw = localStorage.getItem("supabase.auth.token");
      if (raw) {
        const parsed = JSON.parse(raw);
        return parsed?.currentSession?.access_token || null;
      }
    }

    return session?.access_token || null;
  } catch (e) {
    console.warn("⚠️ getToken() 실패:", e);
    return null;
  }
}

// ✅ 공통 fetch 함수
async function req(path: string, init: RequestInit = {}) {
  const token = await getToken();

  const headers = {
    ...(init.headers || {}),
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

// ✅ 공통 API 객체
export const api = {
  me: () => req(`/me`),
  branches: () => req(`/meta/branches`),
  uploads: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    );
    return req(`/uploads${q.toString() ? `?${q}` : ""}`);
  },
  deleteUpload: (id) => req(`/uploads/${id}`, { method: "DELETE" }),
  unclassified: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => [k, String(v)])
    );
    return req(`/transactions/unclassified${q.toString() ? `?${q}` : ""}`);
  },
  categories: () => req(`/categories`),
  createCategory: (body) =>
    req(`/categories`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  assign: (body) =>
    req(`/transactions/assign`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  report: (body) =>
    req(`/reports`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
};