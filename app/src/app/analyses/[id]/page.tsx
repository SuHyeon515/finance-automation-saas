'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/api'
import Link from 'next/link'

export default function AnalysisDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    fetch(`${API_BASE}/analyses/${id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
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
