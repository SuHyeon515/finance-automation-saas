'use client'
import { useEffect, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

type MonthBlock = {
  month: string
  card_sales: number
  pay_sales: number
  cash_sales: number
  account_sales: number
  visitors: number
  reviews: number
  designers_count: number
  interns_count: number
  advisors_count: number
  salaries: { name: string; rank: string; total_amount: number }[]
  fixed_expense: number
  variable_expense: number
}

export default function GPTSalonAnalysisPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')

  const [monthBlocks, setMonthBlocks] = useState<MonthBlock[]>([])
  const [bankInflow, setBankInflow] = useState(0)
  const [cashBalance, setCashBalance] = useState(0)

  // 정액권
  const [passPaidTotal, setPassPaidTotal] = useState(0)
  const [realizedFromPass, setRealizedFromPass] = useState(0)
  const [passBalance, setPassBalance] = useState(0)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 파생 계산
  const totalFixedExpense = monthBlocks.reduce((s, b) => s + (b.fixed_expense || 0), 0)
  const totalVariableExpense = monthBlocks.reduce((s, b) => s + (b.variable_expense || 0), 0)
  const totalExpense = totalFixedExpense + totalVariableExpense

  // ───────── 지점 목록 로드 ─────────
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/meta/branches`, { headers, credentials: 'include' })
        const json = await res.json()
        setBranches(Array.isArray(json) ? json : [])
      } catch {
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ───────── 월별 salon_monthly_data 불러오기 ─────────
  useEffect(() => {
    if (!branch || !startMonth || !endMonth) return
    const fetchMonthly = async () => {
      setLoading(true)
      setError('')
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/salon/monthly-data`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.detail || '불러오기 실패')
        setMonthBlocks(json.months || [])
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchMonthly()
  }, [branch, startMonth, endMonth])

  // ───────── 정액권 잔액 계산 ─────────
  useEffect(() => {
    setPassBalance(passPaidTotal - realizedFromPass)
  }, [passPaidTotal, realizedFromPass])

  // ───────── 사업자 유입 / 통장 잔액 불러오기 ─────────
  useEffect(() => {
    const fetchFinance = async () => {
      if (!branch || !startMonth || !endMonth) return
      const headers = await apiAuthHeader()
      try {
        // 사업자 유입
        const inflowRes = await fetch(`${API_BASE}/transactions/income-filtered`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const inflowJson = await inflowRes.json()
        setBankInflow(inflowJson.bank_inflow || 0)

        // 통장 잔액
        const balRes = await fetch(`${API_BASE}/transactions/latest-balance`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, end_month: endMonth }),
        })
        const balJson = await balRes.json()
        setCashBalance(balJson.balance || 0)
      } catch (err) {
        console.error('❌ 재무 데이터 불러오기 실패:', err)
        setBankInflow(0)
        setCashBalance(0)
      }
    }
    fetchFinance()
  }, [branch, startMonth, endMonth])

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">📊 미용실 재무 리포트</h1>

      {/* ───────── 지점 / 기간 선택 ───────── */}
      <section className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-gray-600">지점</label>
          <select value={branch} onChange={e => setBranch(e.target.value)} className="border rounded px-3 py-2 w-full">
            <option value="">-- 선택 --</option>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-600">시작 월</label>
          <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600">종료 월</label>
          <input type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
      </section>

      {loading && <p className="text-blue-500 animate-pulse">📡 데이터 불러오는 중...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {/* ───────── 월별 인력 현황 & 급여 ───────── */}
      {monthBlocks.map((b, i) => (
        <section key={i} className="border rounded-lg p-4 bg-gray-50 space-y-3">
          <h2 className="font-semibold text-lg">📆 {b.month}</h2>
          <p className="text-sm">
            👥 디자이너 {b.designers_count}명 / 인턴 {b.interns_count}명 / 바이저 {b.advisors_count}명
          </p>

          {b.salaries.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-300">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 border">이름</th>
                    <th className="p-2 border">직급</th>
                    <th className="p-2 border text-right">급여</th>
                  </tr>
                </thead>
                <tbody>
                  {b.salaries.map((s, idx) => (
                    <tr key={idx}>
                      <td className="border p-2">{s.name}</td>
                      <td className="border p-2">{s.rank}</td>
                      <td className="border p-2 text-right">{s.total_amount.toLocaleString()}원</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {/* ───────── 정액권 ───────── */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">🧾 정액권 내역 (기간 전체)</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-sm block">정액권 결제총액</label>
            <input
              type="number"
              value={passPaidTotal || ''}
              onChange={e => setPassPaidTotal(+e.target.value)}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div>
            <label className="text-sm block">정액권 차감총액</label>
            <input
              type="number"
              value={realizedFromPass || ''}
              onChange={e => setRealizedFromPass(+e.target.value)}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div>
            <label className="text-sm block">정액권 잔액 (자동)</label>
            <input
              readOnly
              value={passBalance.toLocaleString()}
              className="border rounded px-3 py-2 w-full bg-gray-100"
            />
          </div>
        </div>
      </section>

      {/* ───────── 기간 전체 요약 ───────── */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">🏦 사업자 통장 / 지출 요약 (기간 전체)</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm block">사업자 유입 총액</label>
            <input readOnly value={bankInflow.toLocaleString()} className="border rounded px-3 py-2 w-full bg-gray-100" />
          </div>
          <div>
            <label className="text-sm block">사업자 통장 현재 잔액</label>
            <input readOnly value={cashBalance.toLocaleString()} className="border rounded px-3 py-2 w-full bg-gray-100" />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">총 고정지출 합계</div>
            <div className="font-semibold text-right">{totalFixedExpense.toLocaleString()}원</div>
          </div>
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">총 변동지출 합계</div>
            <div className="font-semibold text-right">{totalVariableExpense.toLocaleString()}원</div>
          </div>
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">총 지출 합계</div>
            <div className="font-semibold text-right">{totalExpense.toLocaleString()}원</div>
          </div>
        </div>
      </section>

      {/* GPT 버튼 (나중 연결) */}
      <button className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-50">
        GPT 분석 리포트 생성 (준비중)
      </button>
    </main>
  )
}