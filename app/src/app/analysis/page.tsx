'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

export default function GPTSalonAnalysisPage() {
  // ========== 상태 정의 ==========
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState<string>('')

  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [periodText, setPeriodText] = useState('')

  const [totalSales, setTotalSales] = useState(0)
  const [passPaidTotal, setPassPaidTotal] = useState(0)
  const [realizedFromPass, setRealizedFromPass] = useState(0)
  const [passBalance, setPassBalance] = useState(0)

  const [cardSales, setCardSales] = useState(0)
  const [paySales, setPaySales] = useState(0)
  const [cashSales, setCashSales] = useState(0)
  const [accountSales, setAccountSales] = useState(0) // ✅ 계좌이체매출
  const [bankInflow, setBankInflow] = useState(0)     // ✅ 통장유입총액
  const [cashBalance, setCashBalance] = useState(0)   // ✅ 사업자통장잔액

  const [incomeTotal, setIncomeTotal] = useState(0)
  const [expenseTotal, setExpenseTotal] = useState(0)

  const [visitorsTotal, setVisitorsTotal] = useState(0)
  const [interns, setInterns] = useState(0)

  // ✅ 전월 대비 데이터
  const [prevSales, setPrevSales] = useState(0)
  const [prevVisitors, setPrevVisitors] = useState(0)
  const [prevPrice, setPrevPrice] = useState(0)
  const [prevReviews, setPrevReviews] = useState(0)
  const [currentReviews, setCurrentReviews] = useState(0)

  // ✅ 디자이너 데이터
  const [designers, setDesigners] = useState<{ name: string; rank: string; month: string; total_amount: number }[]>([])
  const [designerLoaded, setDesignerLoaded] = useState(false)

  const [result, setResult] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ========== 지점 목록 ==========
  useEffect(() => {
    fetch(`${API_BASE}/meta/branches`, { credentials: 'include' })
      .then(r => r.json())
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])

  // ========== 기간 표시 ==========
  useEffect(() => {
    if (startMonth && endMonth) {
      const s = parseInt(startMonth.split('-')[1])
      const e = parseInt(endMonth.split('-')[1])
      setPeriodText(`${s}~${e}월`)
    }
  }, [startMonth, endMonth])

  // ========== 정액권 잔액 계산 ==========
  useEffect(() => {
    setPassBalance(passPaidTotal - realizedFromPass)
  }, [passPaidTotal, realizedFromPass])

  // ========== 자동 계산 (수입/지출 요약) ==========
  const fetchAutoSummary = async () => {
    if (!branch || !startMonth || !endMonth) return
    try {
      const res = await fetch(`${API_BASE}/transactions/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, start_month: startMonth, end_month: endMonth }),
      })
      if (!res.ok) throw new Error('요약 불러오기 실패')
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

  useEffect(() => {
    if (!branch || !startMonth || !endMonth) return
    const fetchBalance = async () => {
      const res = await fetch(`${API_BASE}/transactions/latest-balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, end_month: endMonth }),
      })
      const data = await res.json()
      setCashBalance(data?.balance || 0)
    }
    fetchBalance()
  }, [branch, endMonth])

  // ========== ✅ 디자이너 데이터 불러오기 ==========
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
        console.error('❌ 디자이너 급여 불러오기 실패:', error.message)
        setDesigners([])
        setDesignerLoaded(true)
        return
      }

      setDesigners(data || [])
      setDesignerLoaded(true)
    }
    fetchDesigners()
  }, [branch, startMonth, endMonth])

  // ========== GPT 분석 요청 ==========
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
        card_sales: cardSales,
        pay_sales: paySales,
        cash_sales: cashSales,
        account_sales: accountSales,
        pass_paid_total: passPaidTotal,
        realized_from_pass: realizedFromPass,
        visitors_total: visitorsTotal,
        bank_inflow: bankInflow,
        cash_balance: cashBalance,
        fixed_expense: expenseTotal, // ✅ 자동 집계 예정
        variable_expense: 0,
        interns,
        prev_sales: prevSales,
        prev_visitors: prevVisitors,
        prev_price: prevPrice,
        prev_reviews: prevReviews,
        current_reviews: currentReviews,
      }

      const res = await fetch(`${API_BASE}/gpt/salon-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setResult(data.analysis)
      setTitle(data.title || '')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ========== 렌더링 ==========
  return (
    <main className="p-6 space-y-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">🤖 GPT 미용실 재무 분석</h1>

      {/* 지점 + 기간 선택 */}
      <div className="grid sm:grid-cols-3 gap-4">
        <div>
          <label className="text-sm text-gray-600 mb-1 block">지점 선택</label>
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="border rounded px-3 py-2 w-full bg-white"
          >
            <option value="">-- 선택하세요 --</option>
            {branches.map(b => <option key={b}>{b}</option>)}
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
      </div>

      {/* ✅ 매출 입력 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">💰 매출/정액권 입력</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div><label>총매출</label><input type="number" value={totalSales} onChange={e => setTotalSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>정액권 결제총액</label><input type="number" value={passPaidTotal} onChange={e => setPassPaidTotal(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>정액권 차감액(실사용)</label><input type="number" value={realizedFromPass} onChange={e => setRealizedFromPass(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <div><label>카드매출</label><input type="number" value={cardSales} onChange={e => setCardSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>페이매출(플랫폼/제휴)</label><input type="number" value={paySales} onChange={e => setPaySales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>현금매출</label><input type="number" value={cashSales} onChange={e => setCashSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-4">
          <div><label>계좌이체매출</label><input type="number" value={accountSales} onChange={e => setAccountSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>사업자 통장 유입총액</label><input type="number" value={bankInflow} onChange={e => setBankInflow(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>

        <p className="text-sm text-gray-700 mt-1">💡 정액권 잔액: {passBalance.toLocaleString()}원</p>
      </div>

      {/* 👥 인턴 / 방문객 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-2">
        <h2 className="font-semibold text-lg">👥 인턴 / 방문객</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label>인턴 수</label><input type="number" value={interns} onChange={e => setInterns(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>방문객 수</label><input type="number" value={visitorsTotal} onChange={e => setVisitorsTotal(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>
      </div>

      {/* 💼 기타 입력 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
        <h2 className="font-semibold text-lg">💼 기타 입력</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
          <label>사업자 통장 현재잔액</label>
          <input
            type="number"
            value={cashBalance}
            readOnly
            className="border rounded px-3 py-2 w-full bg-gray-100"
          />
        </div>
          <div><label>전월 매출(이전기간)</label><input type="number" value={prevSales} onChange={e => setPrevSales(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <div><label>전월 방문객 수</label><input type="number" value={prevVisitors} onChange={e => setPrevVisitors(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>전월 객단가</label><input type="number" value={prevPrice} onChange={e => setPrevPrice(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mt-3">
          <div><label>전월 리뷰 수</label><input type="number" value={prevReviews} onChange={e => setPrevReviews(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
          <div><label>이번월 리뷰 수</label><input type="number" value={currentReviews} onChange={e => setCurrentReviews(+e.target.value)} className="border rounded px-3 py-2 w-full" /></div>
        </div>
      </div>

            {/* 💇 디자이너 급여 데이터 조회 */}
      <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <h2 className="font-semibold text-lg">💇 디자이너 급여 데이터 조회</h2>

        {!branch || !startMonth || !endMonth ? (
          <p className="text-gray-500 text-sm">지점과 기간을 선택하면 디자이너 데이터가 표시됩니다.</p>
        ) : !designerLoaded ? (
          <p className="text-blue-500 text-sm animate-pulse">불러오는 중...</p>
        ) : designers.length === 0 ? (
          <p className="text-red-500 text-sm">해당 지점 / 기간의 디자이너 급여 데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 border">이름</th>
                  <th className="p-2 border">직급</th>
                  <th className="p-2 border">월</th>
                  <th className="p-2 border text-right">총급여</th>
                </tr>
              </thead>
              <tbody>
                {designers.map((d, i) => (
                  <tr key={i} className="hover:bg-gray-50">
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
      </div>

      {/* 자동 요약 */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h2 className="font-semibold text-lg mb-2">📊 자동 계산</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label>수입 합계</label><input type="number" value={incomeTotal} readOnly className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
          <div><label>지출 합계</label><input type="number" value={expenseTotal} readOnly className="border rounded px-3 py-2 w-full bg-gray-100" /></div>
        </div>
      </div>
      {/* 📎 주의사항 요약 */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h2 className="font-semibold text-lg mb-3">📎 주의사항 요약</h2>
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1 leading-relaxed">
          <li>금액은 <span className="font-medium">부가세 포함 실제 수치</span>로 입력하세요.</li>
          <li>
            정액권 금액은 <span className="font-medium">“판매 시점 결제액”</span>과 
            <span className="font-medium"> “차감(사용)액”</span>을 반드시 구분해야 합니다.
          </li>
          <li>
            통장유입액은 <span className="font-medium">카드/페이/현금 정산 후 실제 입금된 금액</span> 기준입니다.
          </li>
          <li>
            잔액(현금보유)은 <span className="font-medium">분석 종료 시점 기준</span>으로 입력해야 합니다.
          </li>
          <li>
            모든 항목을 입력 후, 상단의 
            <span className="font-medium"> “GPT로 재무 분석 요청”</span> 버튼을 눌러
            자동으로 리포트를 생성하세요.
          </li>
        </ul>
      </div>
      {/* 버튼 */}
      <button onClick={handleAnalyze} disabled={loading} className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-50">
        {loading ? 'GPT 분석 중...' : 'GPT로 재무 분석 요청'}
      </button>

      {/* 결과 */}
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