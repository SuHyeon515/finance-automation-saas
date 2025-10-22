// @ts-nocheck
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

// ✅ 토큰 헤더 생성 함수
export const apiAuthHeader = async () => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

// ✅ 공통 요청 함수 (Authorization + credentials 자동 포함)
async function req(path: string, init: RequestInit = {}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = {
    ...(init.headers || {}),
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include", // ✅ 쿠키/세션 포함 (CORS credentials true)
  });

  if (!response.ok) {
    let msg = `${response.status} ${response.statusText}`;
    try {
      const j = await response.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response;
}

// ✅ API 객체
export const api = {
  me: () => req(`/me`),

  branches: () => req(`/meta/branches`),

  uploads: (
    params: {
      branch?: string;
      year?: number;
      month?: number;
      offset?: number;
      limit?: number;
    } = {}
  ) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([_, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
    );
    return req(`/uploads${q.toString() ? `?${q}` : ""}`);
  },

  deleteUpload: (id: string) => req(`/uploads/${id}`, { method: "DELETE" }),

  unclassified: (
    params: {
      branch?: string;
      year?: number;
      month?: number;
      offset?: number;
      limit?: number;
    } = {}
  ) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params)
          .filter(([_, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      )
    );
    return req(`/transactions/unclassified${q.toString() ? `?${q}` : ""}`);
  },

  categories: () => req(`/categories`),

  createCategory: (body: {
    l1: string;
    l2?: string;
    l3?: string;
    is_fixed?: boolean;
  }) =>
    req(`/categories`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),

  assign: (body: {
    transaction_ids: string[];
    category: string;
    category_l1?: string;
    category_l2?: string;
    category_l3?: string;
    is_fixed?: boolean;
    save_rule?: boolean;
    rule_keyword_source?: "vendor" | "description" | "memo" | "any";
  }) =>
    req(`/transactions/assign`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),

  report: (body: {
    year: number;
    month: number;
    branch?: string;
    category?: string;
    granularity?: "day" | "week" | "month" | "year";
  }) =>
    req(`/reports`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
};

// ✅ axios 호환용 api.get / api.post
// @ts-ignore
api.get = async (path: string, options?: any) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const params = options?.params;
  const headers = options?.headers;

  const q = params
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
        )
      ).toString()
    : "";

  const r = await fetch(`${API_BASE}${path}${q}`, {
    method: "GET",
    headers: {
      ...(headers || {}),
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "include",
  });

  const json = await r.json();
  return { data: json };
};

// @ts-ignore
api.post = async (path: string, body?: any, options?: any) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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