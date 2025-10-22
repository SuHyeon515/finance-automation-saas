// @ts-nocheck
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export const apiAuthHeader = async () => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ✅ Authorization 자동 추가 + credentials 포함
async function req(path: string, init: RequestInit = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = {
    ...(init.headers || {}),
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}), // ✅ 토큰 자동 첨부
  };

  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include", // ✅ 쿠키/세션 포함 (로그인 유지)
  });

  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }

  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r;
}

export const api = {
  me: () => req(`/me`),
  branches: () => req(`/meta/branches`),
  uploads: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
    );
    return req(`/uploads${q.toString() ? `?${q}` : ""}`);
  },
  deleteUpload: (id) => req(`/uploads/${id}`, { method: "DELETE" }),
  unclassified: (params = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
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

// ✅ axios 호환
api.get = async (path, options = {}) => {
  const params = options?.params;
  const headers = options?.headers || {};
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const q = params
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(
            ([_, v]) => v !== undefined && v !== null
          )
        )
      ).toString()
    : "";
  const r = await fetch(`${API_BASE}${path}${q}`, {
    method: "GET",
    headers: {
      ...headers,
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // ✅ 추가
    },
    credentials: "include",
  });
  const json = await r.json();
  return { data: json };
};

api.post = async (path, body, options = {}) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}), // ✅ 추가
  };
  const r = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  });
  const json = await r.json();
  return { data: json };
};