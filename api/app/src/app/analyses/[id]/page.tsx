'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api' // ✅ 인증 헤더 추가
import Link from 'next/link'

export default function AnalysisDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) return

    const loadDetail = async () => {
      setLoading(true)
      try {
        const headers = await apiAuthHeader() // ✅ Supabase 토큰 자동 주입
        const res = await fetch(`${API_BASE}/analyses/${id}`, {
          headers,
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('❌ 분석 상세 불러오기 실패:', err)
        setData(null)
      } finally {
        setLoading(false)
      }
    }

    loadDetail()
  }, [id])

  if (loading) return <div className="p-6 text-gray-600">불러오는 중...</div>
  if (!data) return <div className="p-6 text-gray-500">데이터 없음</div>

  return (
    <main className="p-6 max-w-4xl mx-auto space-y-6">
      <Link href="/analyses" className="text-blue-600 text-sm">
        ← 목록으로 돌아가기
      </Link>

      <h1 className="text-2xl font-semibold">{data.title}</h1>
      <div className="text-gray-500">
        {data.branch} · {new Date(data.created_at).toLocaleString('ko-KR')}
      </div>

      <div className="prose whitespace-pre-wrap bg-white p-6 rounded-lg shadow-sm">
        {data.result}
      </div>

      <div className="text-right text-sm text-gray-400">
        분석 ID: {data.id}
      </div>
    </main>
  )
}