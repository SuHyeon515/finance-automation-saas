'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import {
  LineChart, Line, Tooltip, XAxis, YAxis, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

const formatCurrency = (n: number) =>
  (n ?? 0).toLocaleString('ko-KR', { style: 'currency', currency: 'KRW' })

const formatShortNumber = (num: number) => {
  if (num == null) return '0'
  const abs = Math.abs(num)
  if (abs >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B'
  if (abs >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return String(num)
}

export default function ReportsPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startMonth, setStartMonth] = useState(month)
  const [endMonth, setEndMonth] = useState(month)
  const reportRef = useRef<HTMLDivElement>(null)

  /* ===========================
     초기 데이터
  ============================ */
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/meta/branches`, { headers, credentials: 'include' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setBranches(Array.isArray(json) ? json : [])
      } catch {
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  const buildReportBody = () => ({
    year,
    branch,
    start_month: startMonth,
    end_month: endMonth,
  })

  const loadReport = async () => {
    setLoading(true)
    setError('')
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/reports`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(buildReportBody()),
      })
      if (!res.ok) throw new Error(await res.text())
      const result = await res.json()
      result.by_category ??= []
      result.expense_details ??= []
      result.income_details ??= []
      result.summary ??= { total_in: 0, total_out: 0, net: 0 }
      setData(result)
    } catch (e: any) {
      setError(e.message || '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [])

  /* ===========================
     데이터 계산
  ============================ */
  const fixedRows = useMemo(() => data?.expense_details?.filter((r: any) => r.is_fixed) || [], [data])
  const variableRows = useMemo(() => data?.expense_details?.filter((r: any) => !r.is_fixed) || [], [data])
  const incomeRows = useMemo(() => data?.income_details || [], [data])

  const mergeUnclassified = (arr: any[], key: string) => {
    const grouped: Record<string, number> = {}
    arr.forEach((r: any) => {
      const cat = r[key] && r[key].trim() ? r[key] : '미분류'
      grouped[cat] = (grouped[cat] || 0) + Math.abs(r.amount || r.sum || 0)
    })
    return Object.entries(grouped).map(([category, amount]) => ({ category, amount }))
  }

  const groupByCategoryAndDate = (rows: any[], dateKey: string, amountKey: string) => {
    const grouped: Record<string, Record<string, number>> = {}
    rows.forEach(r => {
      const category = r.category || '미분류'
      const date = new Date(r[dateKey]).toISOString().split('T')[0]
      grouped[category] ??= {}
      grouped[category][date] = (grouped[category][date] || 0) + Math.abs(r[amountKey] || 0)
    })
    const result: Record<string, { date: string; amount: number }[]> = {}
    Object.entries(grouped).forEach(([cat, dateObj]) => {
      result[cat] = Object.entries(dateObj)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount }))
    })
    return result
  }

  const stats = [
    { label: '총 수입', value: Math.abs(data?.summary?.total_in || 0), color: 'text-green-600', bg: 'bg-green-50' },
    { label: '총 지출', value: Math.abs(data?.summary?.total_out || 0), color: 'text-red-600', bg: 'bg-red-50' },
    { label: '순이익', value: data?.summary?.net || 0, color: 'text-blue-600', bg: 'bg-blue-50' },
  ]

  const PIE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#22c55e', '#0ea5e9', '#eab308']

  /* ===========================
     ✅ PDF 전체 페이지 캡처 버전
  ============================ */
  const handleDownloadPDF = async () => {
    if (!reportRef.current) return

    const element = reportRef.current
    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      scrollY: -window.scrollY,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF('p', 'mm', 'a4')

    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    let heightLeft = imgHeight
    let position = 0

    const title = `${branch || '전체지점'} 리포트`
    const dateRange = `${year}년 ${startMonth}월 ~ ${endMonth}월`
    const created = `생성일자: ${new Date().toLocaleDateString()}`

    while (heightLeft > 0) {
      pdf.setFontSize(14)
      pdf.text(`📊 ${title}`, 10, 15)
      pdf.setFontSize(10)
      pdf.text(dateRange, 10, 22)
      pdf.text(created, 10, 28)

      pdf.addImage(imgData, 'PNG', 0, position - 30, imgWidth, imgHeight)
      heightLeft -= pdfHeight
      position -= pdfHeight

      if (heightLeft > 0) pdf.addPage()
    }

    pdf.save(`${title}_${year}_${startMonth}~${endMonth}.pdf`)
  }

  /* ===========================
     렌더링
  ============================ */
  return (
    <main className="p-6 space-y-8 bg-gray-100 min-h-screen">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold">📘 리포트 (수입 + 지출)</h1>
        {!!branch && <span className="ml-2 rounded-full bg-black/80 text-white text-xs px-2 py-1">{branch}</span>}
      </header>

      {/* === 필터 바 === */}
      <section className="border rounded-xl p-4 bg-white shadow-sm">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500">지점</label>
            <select className="border rounded px-3 py-2" value={branch} onChange={e => setBranch(e.target.value)}>
              <option value="">전체</option>
              {branches.map(b => <option key={b}>{b}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500">연도</label>
            <input type="number" className="border rounded px-3 py-2 w-24" value={year} onChange={e => setYear(Number(e.target.value))} />
          </div>

          <div>
            <label className="block text-xs text-gray-500">시작 월</label>
            <input type="number" min={1} max={12} className="border rounded px-3 py-2 w-20"
                   value={startMonth} onChange={e => setStartMonth(Number(e.target.value))} />
          </div>

          <div>
            <label className="block text-xs text-gray-500">종료 월</label>
            <input type="number" min={startMonth} max={12} className="border rounded px-3 py-2 w-20"
                   value={endMonth} onChange={e => setEndMonth(Number(e.target.value))} />
          </div>

          <button onClick={loadReport} className="ml-auto bg-black text-white rounded px-4 py-2 hover:opacity-80">
            조회
          </button>

          <button onClick={handleDownloadPDF} className="bg-red-600 text-white rounded px-4 py-2 hover:opacity-80">
            📄 PDF로 저장
          </button>
        </div>

        {data && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {stats.map((s, i) => (
              <div key={i} className={`rounded-lg ${s.bg} border p-4`}>
                <div className="text-xs text-gray-500">{s.label}</div>
                <div className={`text-lg font-bold ${s.color}`}>{formatCurrency(s.value)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {loading && <p>⏳ 불러오는 중...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {data && (
        <div ref={reportRef} className="space-y-10 bg-white p-6 rounded-xl">
          {[
            { title: '📈 수입', colorText: 'text-green-700', stroke: '#16a34a', rows: incomeRows, chartData: mergeUnclassified((data?.by_category || []).filter((v: any) => v.sum > 0).map((v: any) => ({ category: v.category || '미분류', amount: v.sum })), 'category'), tableColor: 'text-green-600' },
            { title: '🏠 고정지출', colorText: 'text-indigo-700', stroke: '#4f46e5', rows: fixedRows, chartData: mergeUnclassified(fixedRows, 'category'), tableColor: 'text-indigo-600' },
            { title: '🚗 변동지출', colorText: 'text-orange-700', stroke: '#f97316', rows: variableRows, chartData: mergeUnclassified(variableRows, 'category'), tableColor: 'text-orange-600' }
          ].map((blk, idx) => (
            <section key={idx} className="bg-white border rounded-xl shadow-sm p-6 space-y-6">
              <h2 className={`text-xl font-semibold ${blk.colorText}`}>{blk.title}</h2>

              <div className="flex flex-col md:flex-row items-start gap-6">
                <div className="flex-1">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={blk.chartData.map(d => ({ name: d.category, value: d.amount }))} dataKey="value" nameKey="name" outerRadius={110}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {blk.chartData.map((_: any, i: number) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex-1 overflow-x-auto">
                  <table className="w-full text-sm border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="p-2 border">분류</th>
                        <th className="p-2 border text-right">비율</th>
                        <th className="p-2 border text-right">금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const total = blk.chartData.reduce((s: number, v: any) => s + v.amount, 0)
                        return (
                          <>
                            {blk.chartData.map((r: any, i: number) => {
                              const percent = total ? (r.amount / total) * 100 : 0
                              return (
                                <tr key={i}>
                                  <td className="p-2 border text-gray-800">{r.category}</td>
                                  <td className="p-2 border text-right text-gray-500">{percent.toFixed(2)}%</td>
                                  <td className={`p-2 border text-right ${blk.tableColor}`}>{formatCurrency(r.amount)}</td>
                                </tr>
                              )
                            })}
                            <tr className="bg-gray-100 font-semibold">
                              <td className="p-2 border text-gray-900">합계</td>
                              <td className="p-2 border text-right text-gray-700">100.00%</td>
                              <td className={`p-2 border text-right ${blk.tableColor}`}>{formatCurrency(total)}</td>
                            </tr>
                          </>
                        )
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm border border-gray-200 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 border">날짜</th>
                      <th className="p-2 border">내용</th>
                      <th className="p-2 border">카테고리</th>
                      <th className="p-2 border text-right">금액</th>
                      <th className="p-2 border">메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blk.rows.length > 0 ? (
                      blk.rows.map((r: any, i: number) => (
                        <tr key={i}>
                          <td className="p-2">{r.tx_date}</td>
                          <td className="p-2">{r.description}</td>
                          <td className="p-2">{r.category || '미분류'}</td>
                          <td className={`p-2 text-right ${blk.tableColor}`}>
                            {formatCurrency(Math.abs(r.amount))}
                          </td>
                          <td className="p-2 text-gray-600">{r.memo || '-'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="text-center text-gray-400 p-3">내역 없음</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}