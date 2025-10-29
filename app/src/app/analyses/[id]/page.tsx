'use client'

import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import Link from 'next/link'
import dynamic from 'next/dynamic'

// ✅ PDF 버튼 (SSR 비활성화)
const ReportPDFButton = dynamic(() => import('@/components/ReportPDFButton'), { ssr: false })

export default function AnalysisDetailPage() {
  const { id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const reportRef = useRef<HTMLDivElement>(null)

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
    <main className="p-6 max-w-5xl mx-auto space-y-8 bg-gray-100 min-h-screen">
      <Link href="/analyses" className="text-blue-600 text-sm">
        ← 목록으로 돌아가기
      </Link>

      {/* ✅ 제목 + PDF 버튼 */}
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">{data.title}</h1>
        <ReportPDFButton
          elementId="analysis-report-container"
          title={data.title || `analysis_${id}`}
        />
      </div>

      <div className="text-gray-500 text-sm">
        {data.branch} · {new Date(data.created_at).toLocaleString('ko-KR')}
      </div>

      {/* ✅ PDF 렌더링 영역 */}
      <div
        id="analysis-report-container"
        ref={reportRef}
        className="bg-white p-8 rounded-xl shadow-sm border space-y-6 leading-relaxed"
      >
        {/* 상단 메타 */}
        <section className="border-b pb-4">
          <h2 className="text-xl font-semibold text-gray-800">📊 GPT 분석 결과</h2>
          <p className="text-sm text-gray-500 mt-1">
            {data.branch} ({data.period_text || '기간 정보 없음'})
          </p>
        </section>

        {/* 본문 */}
        <section className="prose prose-gray max-w-none whitespace-pre-wrap text-gray-800">
          {data.result}
        </section>

        {/* 하단 정보 */}
        <footer className="border-t pt-4 text-right text-xs text-gray-400">
          분석 ID: {data.id}
          <br />
          생성일: {new Date(data.created_at).toLocaleString('ko-KR')}
        </footer>
      </div>
    </main>
  )
}