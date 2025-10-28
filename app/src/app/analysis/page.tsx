'use client'

import { useEffect, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

type MonthBlock = {
  month: string // "2025-06"

  // 수동 입력
  card_sales: number
  pay_sales: number
  cash_sales: number
  account_sales: number
  visitors: number
  reviews: number

  // 자동 계산
  designers_count: number
  interns_count: number
  advisors_count: number
  salaries: { name: string; rank: string; total_amount: number }[]

  fixed_expense: number
  variable_expense: number
}

export default function GPTSalonAnalysisPage() {
  // ================== 기본 상태 ==================
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')

  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [compareMonths, setCompareMonths] = useState<string[]>([])
  const [periodText, setPeriodText] = useState('')

  // 전체 기간 단위 상태
  const [passPaidTotal, setPassPaidTotal] = useState(0)         // 정액권 결제총액
  const [realizedFromPass, setRealizedFromPass] = useState(0)   // 정액권 차감액
  const [passBalance, setPassBalance] = useState(0)             // 자동 계산

  const [bankInflow, setBankInflow] = useState(0)               // 사업자 유입 총액 (자동)
  const [cashBalance, setCashBalance] = useState(0)             // 기간 마지막 현재 잔액 (자동)

  // 비교기간 수동 입력
  const [compareSalesTotal, setCompareSalesTotal] = useState(0)
  const [compareVisitorsTotal, setCompareVisitorsTotal] = useState(0)
  const [compareReviewsTotal, setCompareReviewsTotal] = useState(0)

  // 월별 블록 상태
  const [monthBlocks, setMonthBlocks] = useState<MonthBlock[]>([])

  // 디자이너 급여 전체표 (기간 전체 테이블 용)
  const [designerRowsFull, setDesignerRowsFull] = useState<
    { name: string; rank: string; month: string; total_amount: number }[]
  >([])
  const [designerLoaded, setDesignerLoaded] = useState(false)

  // 로컬 계산 파생값들
  const totalFixedExpense = monthBlocks.reduce((sum, b) => sum + (b.fixed_expense || 0), 0)
  const totalVariableExpense = monthBlocks.reduce((sum, b) => sum + (b.variable_expense || 0), 0)
  const totalExpense = totalFixedExpense + totalVariableExpense

  const compareUnitPrice =
    compareVisitorsTotal > 0 ? Math.round(compareSalesTotal / compareVisitorsTotal) : 0

  // GPT 결과
  const [result, setResult] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ================== 1. 지점 목록 로드 ==================
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
      } catch (err) {
        console.warn('branches 불러오기 실패:', err)
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ================== 2. 기간이 바뀌면 compareMonths / periodText / monthBlocks 초기화 ==================
  useEffect(() => {
    if (!startMonth || !endMonth) return

    // 기간 텍스트(예: "6~8월")
    const s = parseInt(startMonth.split('-')[1])
    const e = parseInt(endMonth.split('-')[1])
    setPeriodText(`${s}~${e}월`)

    // startMonth ~ endMonth의 월 배열 만들기
    const startDate = new Date(startMonth + '-01T00:00:00')
    const endDate = new Date(endMonth + '-01T00:00:00')
    const months: string[] = []

    // inclusive loop
    let cursor = new Date(startDate.getTime())
    while (cursor.getTime() <= endDate.getTime()) {
      const y = cursor.getFullYear()
      const m = String(cursor.getMonth() + 1).padStart(2, '0')
      months.push(`${y}-${m}`)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    setCompareMonths(months)

    // monthBlocks 기본 뼈대 재구성하되, 기존에 있던 사용자 입력은 유지
    setMonthBlocks(prev => {
      // prev를 map으로 유지/merge 하고, 새 months에 없는 애는 버리고,
      // months에 있지만 prev에 없는 애는 새로 만든다.
      const mapPrev: Record<string, MonthBlock> = {}
      prev.forEach(b => (mapPrev[b.month] = b))

      const nextBlocks: MonthBlock[] = months.map(m => {
        const existing = mapPrev[m]
        if (existing) {
          return existing
        }
        return {
          month: m,
          card_sales: 0,
          pay_sales: 0,
          cash_sales: 0,
          account_sales: 0,
          visitors: 0,
          reviews: 0,
          designers_count: 0,
          interns_count: 0,
          advisors_count: 0,
          salaries: [],
          fixed_expense: 0,
          variable_expense: 0,
        }
      })

      return nextBlocks
    })
  }, [startMonth, endMonth])

  // ================== 3. 정액권 잔액 자동 계산 ==================
  useEffect(() => {
    setPassBalance(passPaidTotal - realizedFromPass)
  }, [passPaidTotal, realizedFromPass])

  // ================== 4. 월별 지출 요약 불러오기 (/transactions/summary) ==================
  // -> 각 monthBlock.fixed_expense / variable_expense 채워주고
  // -> totalFixedExpense/totalVariableExpense는 위에서 reduce
  useEffect(() => {
    const fetchSummary = async () => {
      if (!branch || !startMonth || !endMonth) return
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/transactions/summary`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            branch,
            start_month: startMonth,
            end_month: endMonth,
          }),
        })
        const data = await res.json()
        // data: [{ month:"2025-06", fixed_expense:..., variable_expense:... }, ...]

        if (Array.isArray(data)) {
          const byMonth: Record<
            string,
            { fixed_expense: number; variable_expense: number }
          > = {}
          data.forEach((row: any) => {
            byMonth[row.month] = {
              fixed_expense: row.fixed_expense || 0,
              variable_expense: row.variable_expense || 0,
            }
          })

          setMonthBlocks(prev =>
            prev.map(b => {
              const found = byMonth[b.month]
              if (!found) return b
              return {
                ...b,
                fixed_expense: found.fixed_expense,
                variable_expense: found.variable_expense,
              }
            })
          )
        }
      } catch (err) {
        console.error('❌ 지출 요약 불러오기 실패:', err)
      }
    }
    fetchSummary()
  }, [branch, startMonth, endMonth])

  // ================== 5. 사업자 유입 총액 (/transactions/income-filtered) ==================
  //    - 기간 전체 합산 (내수금/기타수입 제외)
  useEffect(() => {
    const fetchBankInflow = async () => {
      if (!branch || !startMonth || !endMonth) return
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/transactions/income-filtered`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            branch,
            start_month: startMonth,
            end_month: endMonth,
          }),
        })
        const data = await res.json()
        setBankInflow(data?.bank_inflow || 0)
      } catch (err) {
        console.error('❌ 사업자 유입 계산 실패:', err)
        setBankInflow(0)
      }
    }
    fetchBankInflow()
  }, [branch, startMonth, endMonth])

  // ================== 6. 통장 잔액 (/transactions/latest-balance) ==================
  //    - endMonth 기준 가장 최신 balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!branch || !endMonth) return
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/transactions/latest-balance`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            branch,
            end_month: endMonth,
          }),
        })
        const data = await res.json()
        setCashBalance(data?.balance || 0)
      } catch (err) {
        console.error('❌ 잔액 조회 실패:', err)
        setCashBalance(0)
      }
    }
    fetchBalance()
  }, [branch, endMonth])

  // ================== 7. 디자이너/인턴 급여 및 인원 통계 (designer_salaries) ==================
  //    - month별 designers_count / interns_count / advisors_count
  //    - month별 salaries[]
  //    - 화면용 전체 테이블 designerRowsFull
  useEffect(() => {
    const fetchSalaries = async () => {
      if (!branch || !startMonth || !endMonth) return
      setDesignerLoaded(false)
      try {
        // supabase 직접 조회 버전
        const { data, error } = await supabase
          .from('designer_salaries')
          .select('name, rank, month, total_amount')
          .eq('branch', branch)
          .gte('month', startMonth)
          .lte('month', endMonth)
          .order('month', { ascending: true })
          .order('name', { ascending: true })

        if (error) {
          console.error('❌ 급여 데이터 실패:', error.message)
          setDesignerRowsFull([])
          setDesignerLoaded(true)
          return
        }

        const rows = data || []
        setDesignerRowsFull(rows)

        // month별 그룹핑해서 인원수 카운트/급여목록 만들기
        const byMonth: Record<
          string,
          {
            designers_count: number
            interns_count: number
            advisors_count: number
            salaries: { name: string; rank: string; total_amount: number }[]
          }
        > = {}

        rows.forEach(r => {
          const m = r.month
          if (!byMonth[m]) {
            byMonth[m] = {
              designers_count: 0,
              interns_count: 0,
              advisors_count: 0,
              salaries: [],
            }
          }

          const rankLower = (r.rank || '').toLowerCase()

          if (/디자이너|실장|부원장|대표원장|대표/.test(rankLower)) {
            byMonth[m].designers_count++
          } else if (/인턴/.test(rankLower)) {
            byMonth[m].interns_count++
          } else if (/바이저|매니저/.test(rankLower)) {
            byMonth[m].advisors_count++
          }

          byMonth[m].salaries.push({
            name: r.name,
            rank: r.rank,
            total_amount: r.total_amount,
          })
        })

        // monthBlocks에 merge
        setMonthBlocks(prev =>
          prev.map(b => {
            const info = byMonth[b.month]
            if (!info) return b
            return {
              ...b,
              designers_count: info.designers_count,
              interns_count: info.interns_count,
              advisors_count: info.advisors_count,
              salaries: info.salaries,
            }
          })
        )

        setDesignerLoaded(true)
      } catch (err) {
        console.error('❌ 급여 조회 중 에러:', err)
        setDesignerRowsFull([])
        setDesignerLoaded(true)
      }
    }
    fetchSalaries()
  }, [branch, startMonth, endMonth])

  // ================== 8. GPT 분석 요청 ==================
  const handleAnalyze = async () => {
    if (!branch) return alert('지점을 선택하세요.')
    if (!startMonth || !endMonth) return alert('기간을 선택하세요.')

    setLoading(true)
    setError('')
    setResult('')
    setTitle('')

    try {
      // payload 구성
      const payload = {
        branch,
        period_text: periodText,
        start_month: startMonth,
        end_month: endMonth,

        // 월별 상세 데이터
        months: monthBlocks.map(b => ({
          month: b.month,
          card_sales: b.card_sales,
          pay_sales: b.pay_sales,
          cash_sales: b.cash_sales,
          account_sales: b.account_sales,
          visitors: b.visitors,
          reviews: b.reviews,
          designers_count: b.designers_count,
          interns_count: b.interns_count,
          advisors_count: b.advisors_count,
          fixed_expense: b.fixed_expense,
          variable_expense: b.variable_expense,
          salaries: b.salaries,
        })),

        // 정액권
        pass_paid_total: passPaidTotal,
        realized_from_pass: realizedFromPass,
        pass_balance: passBalance,

        // 재무 요약 (기간 전체)
        bank_inflow: bankInflow,
        cash_balance: cashBalance,
        total_fixed_expense: totalFixedExpense,
        total_variable_expense: totalVariableExpense,
        total_expense: totalExpense,

        // 비교기간
        compare_sales_total: compareSalesTotal,
        compare_visitors_total: compareVisitorsTotal,
        compare_reviews_total: compareReviewsTotal,
        compare_unit_price: compareUnitPrice,
      }

      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/gpt/salon-analysis`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.detail || 'GPT 분석 호출 실패')
      }

      setResult(data.analysis)
      setTitle(data.title || '')
    } catch (err: any) {
      console.error('❌ GPT 분석 실패:', err)
      setError(err.message || '에러 발생')
    } finally {
        setLoading(false)
    }
  }

  // ================== 렌더링 ==================
  return (
    <main className="p-6 max-w-6xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">🤖 GPT 미용실 재무 분석</h1>

      {/* ───────────────── 지점 / 기간 선택 ───────────────── */}
      <section className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-gray-600 mb-1 block">지점 선택</label>
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="border rounded px-3 py-2 w-full bg-white"
          >
            <option value="">-- 선택하세요 --</option>
            {branches.map(b => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">시작 월</label>
          <input
            type="month"
            value={startMonth}
            onChange={e => setStartMonth(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
        <div>
          <label className="text-sm text-gray-600 mb-1 block">종료 월</label>
          <input
            type="month"
            value={endMonth}
            onChange={e => setEndMonth(e.target.value)}
            className="border rounded px-3 py-2 w-full"
          />
        </div>
      </section>

      {/* ───────────────── 월별 반복 블록 ───────────────── */}
      {monthBlocks.map((block, idx) => (
        <section
          key={block.month}
          className="border rounded-lg p-4 bg-gray-50 space-y-4"
        >
          <h2 className="font-semibold text-lg">
            📆 {block.month} 데이터
          </h2>

          {/* 인원/급여 요약 */}
          <div>
            <h3 className="font-semibold text-sm mb-2">💇 인력 현황 & 급여</h3>
            <p className="text-sm text-gray-700 mb-2">
              디자이너 {block.designers_count}명 / 인턴 {block.interns_count}명 / 바이저 {block.advisors_count}명
            </p>

            {block.salaries.length === 0 ? (
              <p className="text-xs text-gray-500">급여 데이터가 없습니다.</p>
            ) : (
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
                    {block.salaries.map((s, i) => (
                      <tr key={i} className="hover:bg-gray-50">
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
          </div>

          {/* 월별 매출 입력 */}
          <div>
            <h3 className="font-semibold text-sm mb-2">💰 매출 입력 ({block.month})</h3>
            <div className="grid sm:grid-cols-4 gap-4">
              <div>
                <label className="text-sm block">카드매출</label>
                <input
                  type="number"
                  value={block.card_sales || ''}
                  onChange={e => {
                    const val = +e.target.value
                    setMonthBlocks(prev =>
                      prev.map((b, j) =>
                        j === idx ? { ...b, card_sales: val } : b
                      )
                    )
                  }}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div>
                <label className="text-sm block">페이매출</label>
                <input
                  type="number"
                  value={block.pay_sales || ''}
                  onChange={e => {
                    const val = +e.target.value
                    setMonthBlocks(prev =>
                      prev.map((b, j) =>
                        j === idx ? { ...b, pay_sales: val } : b
                      )
                    )
                  }}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div>
                <label className="text-sm block">현금매출</label>
                <input
                  type="number"
                  value={block.cash_sales || ''}
                  onChange={e => {
                    const val = +e.target.value
                    setMonthBlocks(prev =>
                      prev.map((b, j) =>
                        j === idx ? { ...b, cash_sales: val } : b
                      )
                    )
                  }}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
              <div>
                <label className="text-sm block">계좌이체</label>
                <input
                  type="number"
                  value={block.account_sales || ''}
                  onChange={e => {
                    const val = +e.target.value
                    setMonthBlocks(prev =>
                      prev.map((b, j) =>
                        j === idx ? { ...b, account_sales: val } : b
                      )
                    )
                  }}
                  className="border rounded px-3 py-2 w-full"
                />
              </div>
            </div>
          </div>

          {/* 방문객 / 리뷰 */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="font-semibold text-sm block">👥 방문객 수 ({block.month})</label>
              <input
                type="number"
                value={block.visitors || ''}
                onChange={e => {
                  const val = +e.target.value
                  setMonthBlocks(prev =>
                    prev.map((b, j) =>
                      j === idx ? { ...b, visitors: val } : b
                    )
                  )
                }}
                className="border rounded px-3 py-2 w-full"
              />
            </div>
            <div>
              <label className="font-semibold text-sm block">💬 리뷰 수 ({block.month})</label>
              <input
                type="number"
                value={block.reviews || ''}
                onChange={e => {
                  const val = +e.target.value
                  setMonthBlocks(prev =>
                    prev.map((b, j) =>
                      j === idx ? { ...b, reviews: val } : b
                    )
                  )
                }}
                className="border rounded px-3 py-2 w-full"
              />
            </div>
          </div>

          {/* 이 달의 지출 요약 */}
          <div>
            <h3 className="font-semibold text-sm mt-4 mb-2">💸 지출 ({block.month})</h3>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">고정지출 합계</div>
                <div className="font-semibold text-right">
                  {block.fixed_expense.toLocaleString()}원
                </div>
              </div>
              <div className="p-3 border rounded bg-white">
                <div className="text-gray-500">변동지출 합계</div>
                <div className="font-semibold text-right">
                  {block.variable_expense.toLocaleString()}원
                </div>
              </div>
            </div>
          </div>
        </section>
      ))}

      {/* ───────────────── 정액권 정보 (기간 전체) ───────────────── */}
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
            <label className="text-sm block">정액권 차감총액(실사용)</label>
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
              type="number"
              readOnly
              value={passBalance}
              className="border rounded px-3 py-2 w-full bg-gray-100"
            />
          </div>
        </div>
      </section>

      {/* ───────────────── 기간 전체 재무 요약 ───────────────── */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">🏦 사업자 통장 / 지출 요약 (기간 전체)</h2>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm block">사업자 유입 총액 (자동)</label>
            <input
              type="number"
              value={bankInflow}
              onChange={e => setBankInflow(+e.target.value)}
              className="border rounded px-3 py-2 w-full bg-white"
            />
            <p className="text-xs text-gray-500 mt-1">
              내수금 / 기타수입 제외한 실제 유입 합계
            </p>
          </div>

          <div>
            <label className="text-sm block">사업자 통장 현재 잔액 (자동)</label>
            <input
              type="number"
              value={cashBalance}
              readOnly
              className="border rounded px-3 py-2 w-full bg-gray-100"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-3 border rounded bg-white text-sm">
            <div className="text-gray-500">총 고정지출 합계</div>
            <div className="font-semibold text-right">
              {totalFixedExpense.toLocaleString()}원
            </div>
          </div>
          <div className="p-3 border rounded bg-white text-sm">
            <div className="text-gray-500">총 변동지출 합계</div>
            <div className="font-semibold text-right">
              {totalVariableExpense.toLocaleString()}원
            </div>
          </div>
          <div className="p-3 border rounded bg-white text-sm">
            <div className="text-gray-500">총 지출 합계</div>
            <div className="font-semibold text-right">
              {totalExpense.toLocaleString()}원
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────── 비교기간 입력 ───────────────── */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">📊 비교기간 입력</h2>
        <p className="text-sm text-gray-600">
          비교하고 싶은 기간 전체(예: 지난 분기 전체, 지난달 등)의 합계를 입력하세요.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="text-sm block">비교기간 매출 합계</label>
            <input
              type="number"
              value={compareSalesTotal || ''}
              onChange={e => setCompareSalesTotal(+e.target.value)}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div>
            <label className="text-sm block">비교기간 방문객 수</label>
            <input
              type="number"
              value={compareVisitorsTotal || ''}
              onChange={e => setCompareVisitorsTotal(+e.target.value)}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div>
            <label className="text-sm block">비교기간 리뷰 수</label>
            <input
              type="number"
              value={compareReviewsTotal || ''}
              onChange={e => setCompareReviewsTotal(+e.target.value)}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
        </div>

        <div>
          <label className="text-sm block">비교기간 객단가 (자동)</label>
          <input
            type="number"
            readOnly
            value={compareUnitPrice}
            className="border rounded px-3 py-2 w-full bg-gray-100"
          />
        </div>
      </section>

      {/* ───────────────── 디자이너/인턴 급여 전체 테이블 ───────────────── */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">💼 급여 상세 (전체 기간)</h2>

        {!branch || !startMonth || !endMonth ? (
          <p className="text-gray-500 text-sm">
            지점과 기간을 선택하면 급여 데이터가 표시됩니다.
          </p>
        ) : !designerLoaded ? (
          <p className="text-blue-500 text-sm animate-pulse">
            급여 데이터 불러오는 중...
          </p>
        ) : designerRowsFull.length === 0 ? (
          <p className="text-red-500 text-sm">
            해당 기간에 등록된 급여 데이터가 없습니다.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 border">이름</th>
                  <th className="p-2 border">직급</th>
                  <th className="p-2 border">월</th>
                  <th className="p-2 border text-right">급여</th>
                </tr>
              </thead>
              <tbody>
                {designerRowsFull.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="border p-2">{row.name}</td>
                    <td className="border p-2">{row.rank}</td>
                    <td className="border p-2">{row.month}</td>
                    <td className="border p-2 text-right">
                      {row.total_amount?.toLocaleString()}원
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ───────────────── 주의사항 ───────────────── */}
      <section className="border rounded-lg p-4 bg-gray-50">
        <h2 className="font-semibold text-lg mb-3">📎 주의사항 요약</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 leading-relaxed">
          <li>
            금액은 <span className="font-medium">부가세 포함 실제 수치</span>로
            입력하세요.
          </li>
          <li>
            정액권 금액은{' '}
            <span className="font-medium">“판매 시점 결제액”</span>과{' '}
            <span className="font-medium">“차감(사용)액”</span>을
            반드시 구분해야 합니다.
          </li>
          <li>
            사업자 유입 총액은 카드/페이/현금 정산 후 실제 입금액 기준이며,
            <span className="font-medium"> 내수금 / 기타수입은 제외</span>
            됩니다.
          </li>
          <li>
            현재 잔액은 종료월 기준 사업자 통장 잔액입니다.
          </li>
          <li>
            모든 항목 입력 후 아래 버튼을 눌러 GPT 분석 리포트를 생성하세요.
          </li>
        </ul>
      </section>

      {/* ───────────────── GPT 분석 버튼 ───────────────── */}
      <button
        onClick={handleAnalyze}
        disabled={loading}
        className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-50"
      >
        {loading ? 'GPT 분석 중...' : 'GPT로 재무 분석 요청'}
      </button>

      {/* ───────────────── 결과 출력 ───────────────── */}
      {error && <p className="text-red-500">{error}</p>}

      {result && (
        <section className="bg-white rounded-lg p-6 shadow-sm mt-6">
          {title && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
          <pre className="whitespace-pre-wrap leading-relaxed text-gray-800">
            {result}
          </pre>
        </section>
      )}
    </main>
  )
}