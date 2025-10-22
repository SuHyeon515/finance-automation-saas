export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

export const apiAuthHeader = (token?: string) => ({
  headers: { Authorization: `Bearer ${token}` },
})

async function req(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "Accept": "application/json",
    },
    // 쿠키나 토큰 쓰면 여기에 credentials / Authorization 추가
  });
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try {
      const j = await r.json();
      if (j?.detail) msg = j.detail;
    } catch {}
    throw new Error(msg);
  }
  // 파일 다운로드 (엑셀) 같은 바이너리 응답은 호출부에서 처리
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r;
}

export const api = {
  me: () => req(`/me`),
  branches: () => req(`/meta/branches`),
  uploads: (params: {branch?: string; year?: number; month?: number; offset?: number; limit?: number} = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>[k,String(v)])
      )
    );
    return req(`/uploads${q.toString() ? `?${q}` : ""}`);
  },
  deleteUpload: (id: string) => req(`/uploads/${id}`, { method: "DELETE" }),
  unclassified: (params: {branch?: string; year?: number; month?: number; offset?: number; limit?: number} = {}) => {
    const q = new URLSearchParams(
      Object.fromEntries(
        Object.entries(params).filter(([,v])=>v!==undefined && v!==null).map(([k,v])=>[k,String(v)])
      )
    );
    return req(`/transactions/unclassified${q.toString() ? `?${q}` : ""}`);
  },
  categories: () => req(`/categories`),
  createCategory: (body: {l1: string; l2?: string; l3?: string; is_fixed?: boolean}) =>
    req(`/categories`, { method: "POST", body: JSON.stringify(body), headers: {"Content-Type":"application/json"} }),
  assign: (body: {
    transaction_ids: string[];
    category: string;
    category_l1?: string;
    category_l2?: string;
    category_l3?: string;
    is_fixed?: boolean;
    save_rule?: boolean;
    rule_keyword_source?: "vendor"|"description"|"memo"|"any";
  }) =>
    req(`/transactions/assign`, { method: "POST", body: JSON.stringify(body), headers: {"Content-Type":"application/json"} }),
  report: (body: {year:number; month:number; branch?:string; category?:string; granularity?:"day"|"week"|"month"|"year"}) =>
    req(`/reports`, { method: "POST", body: JSON.stringify(body), headers: {"Content-Type":"application/json"} }),
};

// ✅ axios 없이 api.get(), api.post() 같은 형식도 동작하게 호환용 추가
api.get = async (path: string, options?: any) => {
  const params = options?.params
  const headers = options?.headers
  const q = params
    ? '?' +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
        )
      ).toString()
    : ''
  const r = await fetch(`${API_BASE}${path}${q}`, {
    method: 'GET',
    headers: {
      ...(headers || {}),
      Accept: 'application/json',
    },
  })
  const json = await r.json()
  return { data: json }
}

api.post = async (path: string, body?: any, options?: any) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
  }
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await r.json()
  return { data: json }
}