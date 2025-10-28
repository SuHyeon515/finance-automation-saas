'use client'

import { useEffect, useState } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

export default function GPTSalonAnalysisPage() {
  // ================== 상태 정의 ==================
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [periodText, setPeriodText] = useState('')

  // 💰 매출/정액권 관련
  const [totalSales, setTotalSales] = useState(0)
  const [passPaidTotal, setPassPaidTotal] = useState(0)
  const [realizedFromPass, setRealizedFromPass] = useState(0)
  const [passBalance, setPassBalance] = useState(0)
  const [bankInflow, setBankInflow] = useState(0) // ✅ 사업자 유입 자동 계산

  // 💳 매출 분류
  const [cardSales, setCardSales] = useState(0)
  const [paySales, setPaySales] = useState(0)
  const [cashSales, setCashSales] = useState(0)
  const [accountSales, setAccountSales] = useState(0)
  const [cashBalance, setCashBalance] = useState(0)

  // 💹 수입 / 지출 요약
  const [incomeTotal, setIncomeTotal] = useState(0)
  const [expenseTotal, setExpenseTotal] = useState(0)
  const [fixedExpense, setFixedExpense] = useState(0)
  const [variableExpense, setVariableExpense] = useState(0)

  // 👥 인턴 / 방문객
  const [visitorsTotal, setVisitorsTotal] = useState(0)

  // 📊 비교기간
  const [compareMonths, setCompareMonths] = useState<string[]>([])
  const [compareData, setCompareData] = useState<{ month: string; sales: number; visitors: number }[]>([])

  // 💬 리뷰
  const [prevReviews, setPrevReviews] = useState(0)
  const [currentReviews, setCurrentReviews] = useState(0)

  // 💇 인건비 데이터
  const [designerData, setDesignerData] = useState<{ name: string; rank: string; month: string; total_amount: number }[]>([])
  const [monthlyRankStats, setMonthlyRankStats] = useState<{ month: string; designers: number; interns: number; advisors: number }[]>([])
  const [designerLoaded, setDesignerLoaded] = useState(false)

  // GPT 분석 결과
  const [result, setResult] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ================== 지점 목록 ==================
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

  // ================== 기간 텍스트 + 비교개월 ==================
  useEffect(() => {
    if (startMonth && endMonth) {
      const sDate = new Date(startMonth)
      const eDate = new Date(endMonth)
      const months: string[] = []
      while (sDate <= eDate) {
        const y = sDate.getFullYear()
        const m = String(sDate.getMonth() + 1).padStart(2, '0')
        months.push(`${y}-${m}`)
        sDate.setMonth(sDate.getMonth() + 1)
      }
      setCompareMonths(months)
      const s = parseInt(startMonth.split('-')[1])
      const e = parseInt(endMonth.split('-')[1])
      setPeriodText(`${s}~${e}월`)
    }
  }, [startMonth, endMonth])

  // ================== 정액권 잔액 ==================
  useEffect(() => {
    setPassBalance(passPaidTotal - realizedFromPass)
  }, [passPaidTotal, realizedFromPass])

  // ================== 자동 계산 (수입/지출) ==================
  const fetchAutoSummary = async () => {
    if (!branch || !startMonth || !endMonth) return
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/transactions/summary`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
      })
      const data = await res.json()
      setIncomeTotal(data?.income_total || 0)
      setExpenseTotal(data?.expense_total || 0)
      setFixedExpense(data?.fixed_expense || 0)
      setVariableExpense(data?.variable_expense || 0)
    } catch (err) {
      console.error('❌ 수입/지출 계산 실패:', err)
    }
  }
  useEffect(() => {
    fetchAutoSummary()
  }, [branch, startMonth, endMonth])

  // ================== 사업자 유입 ==================
  const fetchBankInflow = async () => {
    if (!branch || !startMonth || !endMonth) return
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/transactions/income-filtered`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
      })
      const data = await res.json()
      setBankInflow(data?.bank_inflow || 0)
    } catch (err) {
      console.error('❌ 사업자 유입 계산 실패:', err)
      setBankInflow(0)
    }
  }
  useEffect(() => {
    fetchBankInflow()
  }, [branch, startMonth, endMonth])

  // ================== 현금 잔액 ==================
  useEffect(() => {
    if (!branch || !endMonth) return
    const fetchBalance = async () => {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/transactions/latest-balance`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, end_month: endMonth }),
      })
      const data = await res.json()
      setCashBalance(data?.balance || 0)
    }
    fetchBalance()
  }, [branch, endMonth])

  // ================== 인건비 ==================
  useEffect(() => {
    if (!branch || !startMonth || !endMonth) return
    const fetchDesigners = async () => {
      setDesignerLoaded(false)
      const { data, error } = await supabase
        .from('designer_salaries')
        .select('name, rank, month, total_amount')
        .eq('branch', branch)
        .gte('month', startMonth)
        .lte('month', endMonth)
        .order('month', { ascending: true })

      if (error) {
        console.error('❌ 급여 데이터 실패:', error.message)
        setDesignerData([])
        setDesignerLoaded(true)
        return
      }

      setDesignerData(data || [])
      const grouped = (data || []).reduce((acc: any, cur: any) => {
        const { month, rank } = cur
        if (!acc[month]) acc[month] = { designers: 0, interns: 0, advisors: 0 }
        const r = (rank || '').toLowerCase()
        if (/디자이너|실장|부원장|대표/.test(r)) acc[month].designers++
        else if (/인턴/.test(r)) acc[month].interns++
        else if (/바이저|매니저/.test(r)) acc[month].advisors++
        return acc
      }, {})
      setMonthlyRankStats(Object.entries(grouped).map(([m, o]: any) => ({ month: m, ...o })))
      setDesignerLoaded(true)
    }
    fetchDesigners()
  }, [branch, startMonth, endMonth])

  // ================== GPT 분석 ==================
  const handleAnalyze = async () => {
    if (!branch || !startMonth || !endMonth) return alert('지점/기간을 선택하세요.')
    setLoading(true)
    setError('')
    setResult('')
    setTitle('')

    try {
      const payload = {
        branch,
        period_text: periodText,
        start_month: startMonth,
        end_month: endMonth,
        total_sales: totalSales,
        card_sales: cardSales,
        pay_sales: paySales,
        cash_sales: cashSales,
        account_sales: accountSales,
        bank_inflow: bankInflow,
        visitors_total: visitorsTotal,
        pass_paid_total: passPaidTotal,
        realized_from_pass: realizedFromPass,
        pass_balance: passBalance,
        fixed_expense: fixedExpense,
        variable_expense: variableExpense,
        compare_data: compareData,
        current_reviews: currentReviews,
        prev_reviews: prevReviews,
        designer_stats: monthlyRankStats,
      }

      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/gpt/salon-analysis`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      setResult(data.analysis)
      setTitle(data.title || '')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ================== 렌더링 ==================
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">🤖 GPT 미용실 재무 분석 (확장버전)</h1>

      {/* ========== 지점 / 기간 선택 ========== */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-sm">지점 선택</label>
          <select value={branch} onChange={e => setBranch(e.target.value)} className="border rounded px-3 py-2 w-full bg-white">
            <option value="">-- 선택하세요 --</option>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">시작 월</label>
          <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label className="text-sm">종료 월</label>
          <input type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} className="border rounded px-3 py-2 w-full" />
        </div>
      </div>

      {/* 💳 매출 상세 입력 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">💰 매출 세부 입력</h2>
        <div className="grid sm:grid-cols-4 gap-4">
          <div><label>카드매출</label><input type="number" value={cardSales} onChange={e => setCardSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>페이매출</label><input type="number" value={paySales} onChange={e => setPaySales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>현금매출</label><input type="number" value={cashSales} onChange={e => setCashSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>계좌이체</label><input type="number" value={accountSales} onChange={e => setAccountSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>
      </div>

      {/* 🧾 정액권 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">🧾 정액권 내역</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><label>결제금액</label><input type="number" value={passPaidTotal} onChange={e => setPassPaidTotal(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>차감금액</label><input type="number" value={realizedFromPass} onChange={e => setRealizedFromPass(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>잔액 (자동)</label><input type="number" readOnly value={passBalance} className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
        </div>
      </div>

      {/* 💹 지출 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">💸 지출 요약</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label>고정지출</label><input type="number" readOnly value={fixedExpense} className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
          <div><label>변동지출</label><input type="number" readOnly value={variableExpense} className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
        </div>
      </div>

      {/* 📊 비교기간 동적 입력 */}
      {compareMonths.map((m, i) => (
        <div key={m} className="border rounded-lg p-4 bg-gray-50 space-y-2">
          <h2 className="font-semibold text-lg">{m} 비교 입력</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <div><label>매출</label><input type="number" onChange={e => {
              const val = +e.target.value
              setCompareData(prev => {
                const copy = [...prev]
                copy[i] = { ...copy[i], month: m, sales: val, visitors: copy[i]?.visitors || 0 }
                return copy
              })
            }} className="border rounded px-3 py-2 w-full" /></div>
            <div><label>방문객</label><input type="number" onChange={e => {
              const val = +e.target.value
              setCompareData(prev => {
                const copy = [...prev]
                copy[i] = { ...copy[i], month: m, visitors: val, sales: copy[i]?.sales || 0 }
                return copy
              })
            }} className="border rounded px-3 py-2 w-full" /></div>
            <div><label>객단가 (자동)</label><input readOnly value={
              compareData[i]?.visitors ? Math.round(compareData[i].sales / compareData[i].visitors) : 0
            } className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
          </div>
        </div>
      ))}

      {/* 💬 리뷰 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">💬 리뷰 현황</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label>이전 리뷰 수</label><input type="number" value={prevReviews} onChange={e => setPrevReviews(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>현재 리뷰 수</label><input type="number" value={currentReviews} onChange={e => setCurrentReviews(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>
      </div>

      {/* GPT 분석 버튼 */}
      <button onClick={handleAnalyze} disabled={loading} className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-50">
        {loading ? 'GPT 분석 중...' : 'GPT로 재무 분석 요청'}
      </button>

      {/* 결과 출력 */}
      {error && <p className="text-red-500">{error}</p>}

      {result && (
        <div className="bg-white rounded-lg p-6 shadow-sm mt-6">
          {title && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
          <pre className="whitespace-pre-wrap leading-relaxed text-gray-800">
            {result}
          </pre>
        </div>
      )}
    </main>
  )
}