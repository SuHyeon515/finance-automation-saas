'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import Link from 'next/link'
import ReportPDFButton from '@/components/ReportPDFButton' // ✅ PDF 버튼 불러오기

export default function AnalysisDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!id) return

    const loadDetail = async () => {
      setLoading(true)
      try {
        const headers = await apiAuthHeader()
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

      {/* ✅ 상단 제목 + PDF 버튼 */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold">{data.title}</h1>
        {/* ReportPDFButton 재사용 */}
        <ReportPDFButton
          elementId="analysis-report" // PDF로 변환할 영역 id
          title={data.title || `analysis_${id}`}
        />
      </div>

      <div className="text-gray-500">
        {data.branch} · {new Date(data.created_at).toLocaleString('ko-KR')}
      </div>

      {/* ✅ PDF 변환 대상 영역 */}
      <div
        id="analysis-report"
        className="prose whitespace-pre-wrap bg-white p-6 rounded-lg shadow-sm border"
      >
        {data.result}
      </div>

      <div className="text-right text-sm text-gray-400">
        분석 ID: {data.id}
      </div>
    </main>
  )
}