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

  // 👥 인턴 / 방문객
  const [visitorsTotal, setVisitorsTotal] = useState(0)

  // 📊 비교기간 (전월 대신)
  const [compareSales, setCompareSales] = useState(0)
  const [compareVisitors, setCompareVisitors] = useState(0)
  const [comparePrice, setComparePrice] = useState(0)
  const [prevReviews, setPrevReviews] = useState(0)
  const [currentReviews, setCurrentReviews] = useState(0)

  // 💇 인건비 데이터
  const [designerData, setDesignerData] = useState<
    { name: string; rank: string; month: string; total_amount: number }[]
  >([])
  const [monthlyRankStats, setMonthlyRankStats] = useState<
    { month: string; designers: number; interns: number; advisors: number }[]
  >([])
  const [designerLoaded, setDesignerLoaded] = useState(false)

  // GPT 분석 결과
  const [result, setResult] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ================== 지점 목록 불러오기 ==================
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/meta/branches`, {
          headers,
          credentials: 'include',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setBranches(Array.isArray(json) ? json : [])
      } catch (err) {
        console.warn('branches 불러오기 실패:', err)
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ================== 기간 텍스트 ==================
  useEffect(() => {
    if (startMonth && endMonth) {
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
    } catch (err) {
      console.error('❌ 수입/지출 계산 실패:', err)
      setIncomeTotal(0)
      setExpenseTotal(0)
    }
  }
  useEffect(() => {
    fetchAutoSummary()
  }, [branch, startMonth, endMonth])

  // ================== 사업자 유입 (내수금, 기타 제외) ==================
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

  // ================== 디자이너/인턴/바이저 급여 조회 ==================
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

      // ✅ 월별 인원 통계
      const grouped = (data || []).reduce((acc: any, cur: any) => {
        const { month, rank } = cur
        if (!acc[month]) acc[month] = { designers: 0, interns: 0, advisors: 0 }
        const rankStr = (rank || "").toLowerCase()
        if (/디자이너|실장|부원장|대표/.test(rankStr)) acc[month].designers++
        else if (/인턴/.test(rankStr)) acc[month].interns++
        else if (/바이저|매니저/.test(rankStr)) acc[month].advisors++
        return acc
      }, {})

      const stats = Object.entries(grouped).map(([month, obj]: any) => ({
        month,
        ...obj,
      }))
      setMonthlyRankStats(stats)
      setDesignerLoaded(true)
    }
    fetchDesigners()
  }, [branch, startMonth, endMonth])

  // ================== GPT 분석 요청 ==================
  const handleAnalyze = async () => {
    if (!branch) return alert('지점을 선택하세요.')
    if (!startMonth || !endMonth) return alert('기간을 선택하세요.')

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
        bank_inflow: bankInflow,
        income_total: incomeTotal,
        expense_total: expenseTotal,
        visitors_total: visitorsTotal,
        compare_sales: compareSales,
        compare_visitors: compareVisitors,
        compare_price: comparePrice,
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

      {/* ========== 인원 통계 ========== */}
      {designerLoaded && monthlyRankStats.length > 0 && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h2 className="font-semibold text-lg mb-2">👥 월별 인원 현황</h2>
          <table className="w-full text-sm border">
            <thead className="bg-gray-100">
              <tr>
                <th className="border p-2">월</th>
                <th className="border p-2">디자이너 수</th>
                <th className="border p-2">인턴 수</th>
                <th className="border p-2">바이저 수</th>
              </tr>
            </thead>
            <tbody>
              {monthlyRankStats.map((m, i) => (
                <tr key={i}>
                  <td className="border p-2">{m.month}</td>
                  <td className="border p-2 text-center">{m.designers}</td>
                  <td className="border p-2 text-center">{m.interns}</td>
                  <td className="border p-2 text-center">{m.advisors}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== 급여내역 ========== */}
      {designerLoaded && designerData.length > 0 && (
        <div className="border rounded-lg p-4 bg-gray-50">
          <h2 className="font-semibold text-lg mb-2">💇 디자이너/인턴 급여내역</h2>
          <table className="w-full text-sm border">
            <thead className="bg-gray-100">
              <tr>
                <th className="border p-2">이름</th>
                <th className="border p-2">직급</th>
                <th className="border p-2">월</th>
                <th className="border p-2 text-right">급여</th>
              </tr>
            </thead>
            <tbody>
              {designerData.map((d, i) => (
                <tr key={i}>
                  <td className="border p-2">{d.name}</td>
                  <td className="border p-2">{d.rank}</td>
                  <td className="border p-2">{d.month}</td>
                  <td className="border p-2 text-right">{d.total_amount.toLocaleString()}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ========== 매출 및 기타 ========== */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">💰 매출 / 통장 / 비교기간</h2>

        <div className="grid sm:grid-cols-3 gap-4">
          <div><label>총 매출</label><input type="number" value={totalSales} onChange={e => setTotalSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>사업자 유입총액 (자동)</label><input type="number" value={bankInflow} readOnly className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
          <div><label>잔액</label><input type="number" value={cashBalance} readOnly className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div><label>비교기간 매출</label><input type="number" value={compareSales} onChange={e => setCompareSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>비교기간 방문객 수</label><input type="number" value={compareVisitors} onChange={e => setCompareVisitors(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>비교기간 객단가</label><input type="number" value={comparePrice} onChange={e => setComparePrice(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>
      </div>

      {/* GPT 분석 */}
      <button onClick={handleAnalyze} disabled={loading} className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-50">
        {loading ? 'GPT 분석 중...' : 'GPT로 재무 분석 요청'}
      </button>

      {error && <p className="text-red-500">{error}</p>}
      {result && (
        <div className="bg-white rounded-lg p-6 shadow-sm mt-6">
          {title && <h2 className="text-lg font-semibold mb-2">{title}</h2>}
          <pre className="whitespace-pre-wrap leading-relaxed text-gray-800">{result}</pre>
        </div>
      )}
    </main>
  )
}