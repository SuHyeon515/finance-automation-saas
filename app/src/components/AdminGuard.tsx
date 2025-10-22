// @ts-nocheck
'use client'
import { useEffect, useState } from 'react'
import { api, apiAuthHeader } from '@/lib/api'  // ✅ 이 줄 반드시 추가

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    (async () => {
      const headers = await apiAuthHeader()
      console.log("🔍 headers", headers)
      const res = await api.get('/me', { headers })
      console.log("🔍 /me result", res)
      const role = res?.data?.role || 'viewer'
      setOk(role === 'admin')
    })()
  }, [])
  if (!ok) return <div className="text-center text-sm text-gray-500">이 페이지는 관리자만 접근 가능합니다.</div>
  return <>{children}</>
}
