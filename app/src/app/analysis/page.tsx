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
  pass_paid: number
  pass_used: number
  pass_balance: number
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
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({}) // ✅ 펼치기/접기 상태

  const [bankInflow, setBankInflow] = useState(0)
  const [cashBalance, setCashBalance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 정액권 전체 계산
  const totalPassPaid = monthBlocks.reduce((s, b) => s + (b.pass_paid || 0), 0)
  const totalPassUsed = monthBlocks.reduce((s, b) => s + (b.pass_used || 0), 0)
  const totalPassBalance = totalPassPaid - totalPassUsed

  const totalFixedExpense = monthBlocks.reduce((s, b) => s + (b.fixed_expense || 0), 0)
  const totalVariableExpense = monthBlocks.reduce((s, b) => s + (b.variable_expense || 0), 0)
  const totalExpense = totalFixedExpense + totalVariableExpense

  // ───────── 지점 목록 ─────────
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/meta/branches`, {
          headers,
          credentials: 'include',
        })
        const json = await res.json()
        setBranches(Array.isArray(json) ? json : [])
      } catch {
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ───────── 월별 데이터 + 급여 + 지출 불러오기 ─────────
  useEffect(() => {
    if (!branch || !startMonth || !endMonth) return

    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const headers = await apiAuthHeader()

        // 1️⃣ salon_monthly_data
        const res = await fetch(`${API_BASE}/salon/monthly-data`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.detail || '월별 데이터 불러오기 실패')
        const baseMonths: MonthBlock[] = json.months || []

        // 2️⃣ 고정/변동지출
        const expRes = await fetch(`${API_BASE}/transactions/summary`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const expJson = await expRes.json()
        const expMap: Record<string, { fixed_expense: number; variable_expense: number }> = {}
        expJson?.forEach?.((r: any) => {
          expMap[r.month] = {
            fixed_expense: r.fixed_expense || 0,
            variable_expense: r.variable_expense || 0,
          }
        })

        // 3️⃣ 급여/인원
        const { data: salData } = await supabase
          .from('designer_salaries')
          .select('name, rank, month, total_amount')
          .eq('branch', branch)
          .gte('month', startMonth)
          .lte('month', endMonth)

        const salaryByMonth: Record<
          string,
          {
            designers_count: number
            interns_count: number
            advisors_count: number
            salaries: { name: string; rank: string; total_amount: number }[]
          }
        > = {}

        salData?.forEach((r) => {
          const m = r.month
          if (!salaryByMonth[m]) {
            salaryByMonth[m] = {
              designers_count: 0,
              interns_count: 0,
              advisors_count: 0,
              salaries: [],
            }
          }
          const rank = (r.rank || '').toLowerCase()
          if (/디자이너|실장|부원장|대표원장|대표/.test(rank)) salaryByMonth[m].designers_count++
          else if (/인턴/.test(rank)) salaryByMonth[m].interns_count++
          else if (/바이저|매니저/.test(rank)) salaryByMonth[m].advisors_count++
          salaryByMonth[m].salaries.push({
            name: r.name,
            rank: r.rank,
            total_amount: r.total_amount,
          })
        })

        // 데이터 병합
        const merged = baseMonths.map((b) => ({
          ...b,
          fixed_expense: expMap[b.month]?.fixed_expense || 0,
          variable_expense: expMap[b.month]?.variable_expense || 0,
          ...salaryByMonth[b.month],
        }))

        setMonthBlocks(merged)
      } catch (err: any) {
        console.error('❌ fetch error:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [branch, startMonth, endMonth])

  // ───────── 사업자 유입 / 잔액 ─────────
  useEffect(() => {
    const fetchFinance = async () => {
      if (!branch || !startMonth || !endMonth) return
      const headers = await apiAuthHeader()
      try {
        const inflowRes = await fetch(`${API_BASE}/transactions/income-filtered`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const inflowJson = await inflowRes.json()
        setBankInflow(inflowJson.bank_inflow || 0)

        const balRes = await fetch(`${API_BASE}/transactions/latest-balance`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, end_month: endMonth }),
        })
        const balJson = await balRes.json()
        setCashBalance(balJson.balance || 0)
      } catch (err) {
        console.error('❌ 재무 데이터 실패:', err)
        setBankInflow(0)
        setCashBalance(0)
      }
    }
    fetchFinance()
  }, [branch, startMonth, endMonth])

  // ✅ 펼치기 토글 함수
  const toggleMonth = (m: string) => {
    setOpenMonths((prev) => ({ ...prev, [m]: !prev[m] }))
  }

  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">📊 미용실 재무 리포트</h1>

      {/* ───────── 지점 / 기간 선택 ───────── */}
      <section className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-gray-600">지점</label>
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="border rounded px-3 py-2 w-full">
            <option value="">-- 선택 --</option>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-600">시작 월</label>
          <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label className="text-sm text-gray-600">종료 월</label>
          <input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
      </section>

      {loading && <p className="text-blue-500 animate-pulse">📡 데이터 불러오는 중...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {/* ───────── 월별 상세 ───────── */}
      {monthBlocks.map((b, i) => (
        <section key={i} className="border rounded-lg bg-gray-50">
          <div
            className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-100"
            onClick={() => toggleMonth(b.month)}
          >
            <h2 className="font-semibold text-lg">📆 {b.month}</h2>
            <span className="text-sm text-gray-600">
              {openMonths[b.month] ? '▲ 접기' : '▼ 펼치기'}
            </span>
          </div>

          {openMonths[b.month] && (
            <div className="p-4 border-t space-y-3">
              <p className="text-sm">
                👥 디자이너 {b.designers_count || 0}명 / 인턴 {b.interns_count || 0}명 / 바이저 {b.advisors_count || 0}명
              </p>

              {/* 급여 테이블 */}
              {b.salaries?.length > 0 && (
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

              {/* 매출 및 방문객 */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500 text-sm">총 매출</div>
                  <div className="font-semibold text-lg text-right">
                    {(b.card_sales + b.pay_sales + b.cash_sales + b.account_sales).toLocaleString()}원
                  </div>
                </div>
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500 text-sm">방문객 / 리뷰</div>
                  <div className="font-semibold text-lg text-right">
                    {b.visitors}명 / {b.reviews}건
                  </div>
                </div>
              </div>

              {/* 정액권 */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500 text-sm">정액권 결제</div>
                  <div className="text-right font-semibold">{b.pass_paid?.toLocaleString()}원</div>
                </div>
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500 text-sm">정액권 차감</div>
                  <div className="text-right font-semibold">{b.pass_used?.toLocaleString()}원</div>
                </div>
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500 text-sm">정액권 잔액</div>
                  <div className="text-right font-semibold">{b.pass_balance?.toLocaleString()}원</div>
                </div>
              </div>

              {/* 지출 */}
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500">고정지출</div>
                  <div className="font-semibold text-right">{b.fixed_expense?.toLocaleString()}원</div>
                </div>
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500">변동지출</div>
                  <div className="font-semibold text-right">{b.variable_expense?.toLocaleString()}원</div>
                </div>
                <div className="p-3 border rounded bg-white">
                  <div className="text-gray-500">월 지출합계</div>
                  <div className="font-semibold text-right">
                    {(b.fixed_expense + b.variable_expense).toLocaleString()}원
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      ))}

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

        <div className="border-t pt-4 grid sm:grid-cols-3 gap-4">
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">정액권 결제총액</div>
            <div className="font-semibold text-right">{totalPassPaid.toLocaleString()}원</div>
          </div>
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">정액권 차감총액</div>
            <div className="font-semibold text-right">{totalPassUsed.toLocaleString()}원</div>
          </div>
          <div className="p-3 border rounded bg-white">
            <div className="text-gray-500">정액권 잔액</div>
            <div className="font-semibold text-right">{totalPassBalance.toLocaleString()}원</div>
          </div>
        </div>
      </section>
    </main>
  )
}