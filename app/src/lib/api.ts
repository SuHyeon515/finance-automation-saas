// @ts-nocheck
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "https://finance-automation-saas.onrender.com";

// ✅ 안전한 토큰 읽기 (Next.js SSR 대비)
export const apiAuthHeader = async () => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ✅ 공통 fetch 함수
async function req(path: string, init: RequestInit = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = {
    ...(init.headers || {}),
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), // ✅ 자동 첨부
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

// ✅ axios 호환용
api.get = async (path, options = {}) => {
  const params = options?.params;
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const q = params
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
        )
      ).toString()
    : "";
  const res = await fetch(`${API_BASE}${path}${q}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });
  const json = await res.json();
  return { data: json };
};

api.post = async (path, body, options = {}) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await res.json();
  return { data: json };
};