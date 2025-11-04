'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { API_BASE, apiAuthHeader } from '@/lib/api'

// 간단한 금액 포맷 함수
const fmt = (n: number | null | undefined) =>
  n !== null && n !== undefined ? n.toLocaleString() : '-'

export default function DiagnosisPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [loading, setLoading] = useState(false)
  const [calcResult, setCalcResult] = useState<any>(null) // 1차 계산 결과
  const [gptResult, setGptResult] = useState<any>(null)   // GPT 분석 결과
  const [loadingGpt, setLoadingGpt] = useState(false)
  

  // ✅ 초기 지점 목록 로드
  useEffect(() => {
    (async () => {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/meta/branches`, {
        headers,
        credentials: 'include'
      })
      const json = await res.json()
      setBranches(Array.isArray(json) ? json : [])
    })()
  }, [])

  // ✅ 1차 계산 결과 불러오기
  const loadCalculation = async () => {
    if (!branch || !startMonth || !endMonth) {
      alert('지점과 기간을 선택하세요.')
      return
    }
    setLoading(true)
    setCalcResult(null)
    setGptResult(null)

    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/gpt/financial-diagnosis`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        credentials: 'include'
      })
      const json = await res.json()
      if (res.ok) {
        setCalcResult(json)
      } else {
        alert(json.detail || '진단 데이터 불러오기 실패')
      }
    } catch (err) {
      console.error(err)
      alert('데이터 로드 중 오류 발생')
    } finally {
      setLoading(false)
    }
  }

  // ✅ GPT 분석 요청 (버튼 클릭 시)
  const runGPT = async () => {
    if (!calcResult) return alert('먼저 계산 결과를 불러오세요.')
    setLoadingGpt(true)
    setGptResult(null)
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/gpt/financial-diagnosis`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branch,
          start_month: startMonth,
          end_month: endMonth
        }),
        credentials: 'include'
      })
      const json = await res.json()
      if (res.ok) setGptResult(json)
      else alert(json.detail || 'GPT 분석 실패')
    } catch (e) {
      alert('GPT 분석 중 오류')
      console.error(e)
    } finally {
      setLoadingGpt(false)
    }
  }

  // ✅ 엑셀 다운로드 (1차 결과)
  const downloadExcel = () => {
    if (!calcResult?.months) return alert('다운로드할 데이터가 없습니다.')
    const rows = calcResult.months.map((m: any) => ({
      월: m.month,
      총매출: m.monthly_sales,
      방문객수: m.visitors,
      재방문객수: m.returning_visitors,
      객단가: Math.round(m.unit_sales),
      재방문율: m.revisit_rate?.toFixed(1) + '%',
      정액권비중: m.pass_ratio?.toFixed(1) + '%',
      고정비비율: m.fixed_ratio?.toFixed(1) + '%',
      인건비비율: m.labor_ratio?.toFixed(1) + '%',
      재료비비율: m.material_ratio?.toFixed(1) + '%',
      영업이익률: m.op_margin_est?.toFixed(1) + '%'
    }))
    const csv =
      Object.keys(rows[0]).join(',') +
      '\n' +
      rows.map(r => Object.values(r).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${branch}_${startMonth}_${endMonth}_진단.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">💇‍♀️ 미용실 재무건전성 진단</h1>

      {/* === 입력 영역 === */}
      <div className="grid grid-cols-4 gap-3">
        <select
          className="border rounded p-2"
          value={branch}
          onChange={e => setBranch(e.target.value)}
        >
          <option value="">--지점--</option>
          {branches.map(b => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <input
          type="month"
          className="border rounded p-2"
          value={startMonth}
          onChange={e => setStartMonth(e.target.value)}
        />
        <input
          type="month"
          className="border rounded p-2"
          value={endMonth}
          onChange={e => setEndMonth(e.target.value)}
        />
        <button
          onClick={loadCalculation}
          disabled={loading}
          className="bg-black text-white rounded p-2 hover:opacity-80"
        >
          {loading ? '불러오는 중...' : '📊 1차 계산 실행'}
        </button>
      </div>

      {/* === 1차 계산 결과 === */}
      {calcResult && (
        <section className="space-y-5">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              📅 {calcResult.branch} ({calcResult.period})
            </h2>
            <div className="space-x-3">
              <span className="text-sm text-gray-600">
                등급 예상: <b>{calcResult.grade}</b>
              </span>
              <button
                onClick={downloadExcel}
                className="border px-3 py-1 rounded hover:bg-gray-100"
              >
                ⬇️ 엑셀 다운로드
              </button>
            </div>
          </div>

          {/* 월별 테이블 */}
          <table className="w-full border text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 border">월</th>
                <th className="p-2 border">총매출</th>
                <th className="p-2 border">방문객</th>
                <th className="p-2 border">재방문</th>
                <th className="p-2 border">객단가</th>
                <th className="p-2 border">재방문율</th>
                <th className="p-2 border">정액권비중</th>
                <th className="p-2 border">고정비비율</th>
                <th className="p-2 border">인건비비율</th>
                <th className="p-2 border">재료비비율</th>
                <th className="p-2 border">영업이익률</th>
              </tr>
            </thead>
            <tbody>
              {calcResult.months.map((m: any) => (
                <tr key={m.month} className="text-center">
                  <td className="border p-2">{m.month}</td>
                  <td className="border p-2">{fmt(m.monthly_sales)}</td>
                  <td className="border p-2">{m.visitors}</td>
                  <td className="border p-2">{m.returning_visitors}</td>
                  <td className="border p-2">
                    {m.unit_sales ? fmt(Math.round(m.unit_sales)) : '-'}
                  </td>
                  <td className="border p-2">
                    {m.revisit_rate ? m.revisit_rate.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border p-2">
                    {m.pass_ratio ? m.pass_ratio.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border p-2">
                    {m.fixed_ratio ? m.fixed_ratio.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border p-2">
                    {m.labor_ratio ? m.labor_ratio.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border p-2">
                    {m.material_ratio ? m.material_ratio.toFixed(1) + '%' : '-'}
                  </td>
                  <td className="border p-2">
                    {m.op_margin_est ? m.op_margin_est.toFixed(1) + '%' : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 현금유보·부채 */}
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              💰 <b>현금유보비율:</b>{' '}
              {calcResult.cash_buffer_ratio
                ? calcResult.cash_buffer_ratio.toFixed(1)
                : '-'}
              % / <b>부채비율:</b>{' '}
              {calcResult.debt_ratio
                ? calcResult.debt_ratio.toFixed(1)
                : '-'}
              %
            </p>
            <p>
              🏦 3개월 필요 현금:{' '}
              {fmt(calcResult.need_3m_cash)}원
            </p>
          </div>

          {/* GPT 분석 버튼 */}
          <div className="flex justify-end">
            <button
              onClick={runGPT}
              disabled={loadingGpt}
              className="bg-blue-600 text-white rounded px-4 py-2 hover:opacity-80"
            >
              {loadingGpt ? 'GPT 분석 중...' : '🤖 GPT 진단 리포트 생성'}
            </button>
          </div>
        </section>
      )}

      {/* === GPT 분석 결과 === */}
      {gptResult && (
        <section className="space-y-4 border-t pt-4">
          <h2 className="text-xl font-semibold">📑 GPT 진단 결과</h2>
          <article className="prose whitespace-pre-wrap text-sm leading-relaxed">
            {gptResult.analysis}
          </article>
        </section>
      )}
    </main>
  )
}