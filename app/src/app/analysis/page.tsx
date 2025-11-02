'use client'
import { useEffect, useState, useRef } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

type SalaryItem = {
  name: string
  rank: string
  total_amount: number
}

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
  salaries: SalaryItem[]
  fixed_expense: number
  variable_expense: number
  bank_inflow: number
  owner_dividend?: number // ✅ 사업자배당 항목 추가
}

export default function GPTSalonAnalysisPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [monthBlocks, setMonthBlocks] = useState<MonthBlock[]>([])
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({})
  const [cashBalance, setCashBalance] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ✅ GPT 분석 관련 state
  const [result, setResult] = useState('')
  const [title, setTitle] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisId, setAnalysisId] = useState<string | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  // ✅ 전체 합계 계산
  const totalPassPaid = monthBlocks.reduce((s, b) => s + (b.pass_paid || 0), 0)
  const totalPassUsed = monthBlocks.reduce((s, b) => s + (b.pass_used || 0), 0)
  const totalPassBalance = totalPassPaid - totalPassUsed
  const totalFixedExpense = monthBlocks.reduce((s, b) => s + (b.fixed_expense || 0), 0)
  const totalVariableExpense = monthBlocks.reduce((s, b) => s + (b.variable_expense || 0), 0)
  const totalExpense = totalFixedExpense + totalVariableExpense
  const totalBankInflow = monthBlocks.reduce((s, b) => s + (b.bank_inflow || 0), 0)
  const totalOwnerDividend = monthBlocks.reduce((s, b) => s + (b.owner_dividend || 0), 0) // ✅ 추가

  // ───────── 지점 목록 불러오기 ─────────
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
  // ───────── 메인 데이터 불러오기 ─────────
  useEffect(() => {
    if (!branch || !startMonth || !endMonth) return

    const fetchAll = async () => {
      setLoading(true)
      setError('')
      try {
        const headers = await apiAuthHeader()

        // 1️⃣ 월별 기본 데이터 (카테고리 기준 매출)
        const res = await fetch(`${API_BASE}/salon/monthly-data`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.detail || '월별 데이터 불러오기 실패')
        const baseMonths = json.months || []

        // 2️⃣ 직접 입력 매출 (입력 데이터) 불러오기
        const inputRes = await fetch(`${API_BASE}/salon/input-sales`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const inputJson = await inputRes.json()
        const inputMap: Record<
          string,
          { input_card_sales: number; input_pay_sales: number }
        > = {}

        inputJson?.forEach?.((r: any) => {
          inputMap[r.month] = {
            input_card_sales: r.card_sales || 0,
            input_pay_sales: r.pay_sales || 0,
          }
        })

        // 3️⃣ 지출 / 배당
        const expRes = await fetch(`${API_BASE}/transactions/summary`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
        })
        const expJson = await expRes.json()
        const expMap: Record<string, { fixed_expense: number; variable_expense: number }> = {}
        const dividendMap: Record<string, number> = {}
        expJson?.forEach?.((r: any) => {
          const m = r.month
          expMap[m] = {
            fixed_expense: r.fixed_expense || 0,
            variable_expense: r.variable_expense || 0,
          }
          dividendMap[m] = r.owner_dividend || 0
        })

        // 4️⃣ 급여 / 인원
        const { data: salaryData } = await supabase
          .from('designer_salaries')
          .select('name, rank, month, total_amount')
          .eq('branch', branch)
          .gte('month', startMonth)
          .lte('month', endMonth)

        const salaryByMonth: Record<
          string,
          { designers_count: number; interns_count: number; advisors_count: number; salaries: any[] }
        > = {}

        salaryData?.forEach((r) => {
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

        // 5️⃣ 월별 사업자 유입
        const inflowByMonth: Record<string, number> = {}
        for (const b of baseMonths) {
          const inflowRes = await fetch(`${API_BASE}/transactions/income-filtered`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ branch, start_month: b.month, end_month: b.month }),
          })
          const inflowJson = await inflowRes.json()
          inflowByMonth[b.month] = inflowJson.bank_inflow || 0
        }

        // 6️⃣ 모든 데이터 병합
        const merged = baseMonths.map((b: any) => ({
          ...b,
          input_card_sales: inputMap[b.month]?.input_card_sales || 0, // ✅ 실제 입력 데이터
          input_pay_sales: inputMap[b.month]?.input_pay_sales || 0,
          category_card_sales: b.card_sales, // ✅ 엑셀/카테고리 기준
          category_pay_sales: b.pay_sales,
          fixed_expense: expMap[b.month]?.fixed_expense || 0,
          variable_expense: expMap[b.month]?.variable_expense || 0,
          owner_dividend: dividendMap[b.month] || 0,
          designers_count: salaryByMonth[b.month]?.designers_count || 0,
          interns_count: salaryByMonth[b.month]?.interns_count || 0,
          advisors_count: salaryByMonth[b.month]?.advisors_count || 0,
          salaries: salaryByMonth[b.month]?.salaries || [],
          bank_inflow: inflowByMonth[b.month] || 0,
        }))

        setMonthBlocks(merged)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [branch, startMonth, endMonth])


  // ───────── 통장 잔액 ─────────
  useEffect(() => {
    const fetchBalance = async () => {
      if (!branch || !endMonth) return
      const headers = await apiAuthHeader()
      try {
        const res = await fetch(`${API_BASE}/transactions/latest-balance`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ branch, end_month: endMonth }),
        })
        const json = await res.json()
        setCashBalance(json.balance || 0)
      } catch {
        setCashBalance(0)
      }
    }
    fetchBalance()
  }, [branch, endMonth])

  const toggleMonth = (m: string) => setOpenMonths((p) => ({ ...p, [m]: !p[m] }))


  // 🧠 GPT 분석 호출
  const handleAnalyze = async () => {
    if (!branch || !startMonth || !endMonth) return alert('지점과 기간을 선택하세요.')
    setAnalyzing(true)
    setResult('')
    setTitle('')

    try {
      const headers = await apiAuthHeader()
      const payload = {
        branch,
        start_month: startMonth,
        end_month: endMonth,
        months: monthBlocks, // ✅ 이제 input_* / category_* 모두 포함됨
      }

      const res = await fetch(`${API_BASE}/gpt/salon-analysis`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data?.detail || 'GPT 분석 실패')

      setResult(data.analysis)
      setTitle(data.title)
      setAnalysisId(data.analysis_id || null)
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }), 300)
    } catch (err: any) {
      alert(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

 return (
  <main className="p-6 max-w-6xl mx-auto space-y-8">
    <h1 className="text-2xl font-bold">📊 미용실 재무 리포트</h1>

    {/* 지점 / 기간 선택 */}
    <section className="grid sm:grid-cols-3 gap-4">
      <div>
        <label className="text-sm text-gray-600">지점</label>
        <select
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        >
          <option value="">-- 선택 --</option>
          {branches.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm text-gray-600">시작 월</label>
        <input
          type="month"
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>
      <div>
        <label className="text-sm text-gray-600">종료 월</label>
        <input
          type="month"
          value={endMonth}
          onChange={(e) => setEndMonth(e.target.value)}
          className="border rounded px-3 py-2 w-full"
        />
      </div>
    </section>

    {loading && <p className="text-blue-500 animate-pulse">📡 데이터 불러오는 중...</p>}
    {error && <p className="text-red-500">{error}</p>}

    {/* 월별 블록 */}
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
          <div className="p-4 border-t space-y-4">
            <p className="text-sm">
              👥 디자이너 {b.designers_count}명 / 인턴 {b.interns_count}명 / 바이저{' '}
              {b.advisors_count}명
            </p>

            {/* 급여 */}
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
                        <td className="border p-2 text-right">
                          {s.total_amount.toLocaleString()}원
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 매출/방문객/유입 */}
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">총 매출</div>
                <div className="font-semibold text-lg text-right">
                  {(
                    b.card_sales +
                    b.pay_sales +
                    b.cash_sales +
                    b.account_sales
                  ).toLocaleString()}
                  원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">방문객 / 리뷰</div>
                <div className="font-semibold text-lg text-right">
                  {b.visitors}명 / {b.reviews}건
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">💰 사업자 유입</div>
                <div className="font-semibold text-lg text-right">
                  {b.bank_inflow?.toLocaleString()}원
                </div>
              </div>
            </div>

            {/* 정액권 */}
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">정액권 결제</div>
                <div className="text-right font-semibold">
                  {b.pass_paid?.toLocaleString()}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">정액권 차감</div>
                <div className="text-right font-semibold">
                  {b.pass_used?.toLocaleString()}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500 text-sm">정액권 잔액</div>
                <div className="text-right font-semibold">
                  {b.pass_balance?.toLocaleString()}원
                </div>
              </div>
            </div>

            {/* 지출 */}
            <div className="grid sm:grid-cols-4 gap-4 text-sm">
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">고정지출</div>
                <div className="font-semibold text-right">
                  {b.fixed_expense?.toLocaleString()}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">변동지출</div>
                <div className="font-semibold text-right">
                  {b.variable_expense?.toLocaleString()}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">사업자 배당</div>
                <div className="font-semibold text-right text-amber-600">
                  {b.owner_dividend?.toLocaleString() || 0}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">월 지출합계</div>
                <div className="font-semibold text-right">
                  {(b.fixed_expense + b.variable_expense + (b.owner_dividend || 0)).toLocaleString()}
                  원
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    ))}

    {/* 전체 요약 */}
    <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
      <h2 className="font-semibold text-lg">🏦 사업자 통장 / 지출 요약 (기간 전체)</h2>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm block">사업자 유입 총액</label>
          <input
            readOnly
            value={totalBankInflow.toLocaleString()}
            className="border rounded px-3 py-2 w-full bg-gray-100"
          />
        </div>
        <div>
          <label className="text-sm block">사업자 통장 현재 잔액</label>
          <input
            readOnly
            value={cashBalance.toLocaleString()}
            className="border rounded px-3 py-2 w-full bg-gray-100"
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-4 text-sm">
        <div className="p-3 border rounded bg-white">
          <div className="text-gray-500">총 고정지출 합계</div>
          <div className="font-semibold text-right">{totalFixedExpense.toLocaleString()}원</div>
        </div>
        <div className="p-3 border rounded bg-white">
          <div className="text-gray-500">총 변동지출 합계</div>
          <div className="font-semibold text-right">{totalVariableExpense.toLocaleString()}원</div>
        </div>
        <div className="p-3 border rounded bg-white">
          <div className="text-gray-500 text-amber-600">총 사업자배당 합계</div>
          <div className="font-semibold text-right text-amber-600">
            {totalOwnerDividend.toLocaleString()}원
          </div>
        </div>
        <div className="p-3 border rounded bg-white">
          <div className="text-gray-500">총 지출 합계</div>
          <div className="font-semibold text-right">
            {(totalExpense + totalOwnerDividend).toLocaleString()}원
          </div>
        </div>
      </div>

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
    </section>

    {/* ───────── GPT 분석 버튼 ───────── */}
    <button
      onClick={handleAnalyze}
      disabled={analyzing || monthBlocks.length === 0}
      className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-40 mt-6"
    >
      {analyzing ? 'GPT 분석 중...' : '🤖 GPT로 재무 분석 리포트 생성'}
    </button>

    {/* ───────── GPT 결과 출력 ───────── */}
    {result && (
      <section
        ref={resultRef}
        className="bg-white border rounded-lg shadow-sm p-6 space-y-3 mt-6"
      >
        <h2 className="text-lg font-semibold">{title || 'GPT 분석 결과'}</h2>
        <pre className="whitespace-pre-wrap leading-relaxed text-gray-800">{result}</pre>
        {analysisId && (
          <p className="text-xs text-gray-400 text-right">저장됨 ID: {analysisId}</p>
        )}
      </section>
    )}
  </main>
)
}