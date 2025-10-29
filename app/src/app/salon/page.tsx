'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { API_BASE, apiAuthHeader } from '@/lib/api'

export default function SalonDataEntryPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [month, setMonth] = useState('')
  const [form, setForm] = useState({
    card_sales: 0,
    pay_sales: 0,
    cash_sales: 0,
    account_sales: 0,
    visitors: 0,
    reviews: 0,
    pass_paid: 0,
    pass_used: 0,
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const [recentData, setRecentData] = useState<any[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // ✅ 새로 추가
  const [mergedRows, setMergedRows] = useState<any[]>([]) // 실제 합산된 항목 목록
  const [mergeCount, setMergeCount] = useState(0)

  const totalSales =
    form.card_sales + form.pay_sales + form.cash_sales + form.account_sales
  const passBalance = form.pass_paid - form.pass_used

  // ✅ 브랜치 목록 로드
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
        console.error('지점 목록 불러오기 실패:', err)
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ✅ 기존 저장 데이터 자동 불러오기 (여러 건 합산 + 세부 목록 표시)
  useEffect(() => {
    const loadExisting = async () => {
      if (!branch || !month) return
      const user = (await supabase.auth.getUser()).data.user
      if (!user) return

      setLoading(true)
      const { data, error } = await supabase
        .from('salon_monthly_data')
        .select('*')
        .eq('user_id', user.id)
        .eq('branch', branch)
        .eq('month', month)
      setLoading(false)

      if (error) {
        console.error('불러오기 실패:', error)
        return
      }

      if (data && data.length > 0) {
        const total = data.reduce(
          (acc, cur) => ({
            card_sales: acc.card_sales + (cur.card_sales || 0),
            pay_sales: acc.pay_sales + (cur.pay_sales || 0),
            cash_sales: acc.cash_sales + (cur.cash_sales || 0),
            account_sales: acc.account_sales + (cur.account_sales || 0),
            visitors: acc.visitors + (cur.visitors || 0),
            reviews: acc.reviews + (cur.reviews || 0),
            pass_paid: acc.pass_paid + (cur.pass_paid || 0),
            pass_used: acc.pass_used + (cur.pass_used || 0),
          }),
          {
            card_sales: 0,
            pay_sales: 0,
            cash_sales: 0,
            account_sales: 0,
            visitors: 0,
            reviews: 0,
            pass_paid: 0,
            pass_used: 0,
          }
        )
        setForm(total)
        setMergedRows(data) // ✅ 세부 항목 표시용
        setMergeCount(data.length)
      } else {
        setForm({
          card_sales: 0,
          pay_sales: 0,
          cash_sales: 0,
          account_sales: 0,
          visitors: 0,
          reviews: 0,
          pass_paid: 0,
          pass_used: 0,
        })
        setMergedRows([])
        setMergeCount(0)
      }
    }
    loadExisting()
  }, [branch, month])

  // ✅ 저장
  const handleSave = async () => {
    if (!branch || !month) return alert('지점과 월을 선택하세요.')
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return alert('로그인 필요')

    const { error } = await supabase
      .from('salon_monthly_data')
      .upsert(
        {
          user_id: user.id,
          branch,
          month,
          ...form,
          total_sales: totalSales,
          pass_balance: passBalance,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,branch,month' }
      )

    if (error) alert('저장 실패: ' + error.message)
    else {
      setSaved(true)
      loadRecent()
      setTimeout(() => setSaved(false), 2000)
    }
  }

  // 🧾 최근 저장 내역 불러오기
  const loadRecent = async () => {
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return
    setLoadingList(true)
    const { data, error } = await supabase
      .from('salon_monthly_data')
      .select(
        'id, branch, month, card_sales, pay_sales, cash_sales, account_sales, total_sales, visitors, reviews, pass_paid, pass_used, pass_balance, updated_at'
      )
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(10)
    setLoadingList(false)
    if (error) console.error('리스트 불러오기 오류:', error)
    else setRecentData(data || [])
  }

  // 🧾 삭제
  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const { error } = await supabase
      .from('salon_monthly_data')
      .delete()
      .eq('id', id)
    if (error) alert('삭제 실패: ' + error.message)
    else {
      alert('삭제 완료!')
      loadRecent()
    }
  }

  // 🧾 리스트 항목 클릭 시 → 폼에 불러오기
  const handleRowClick = (row: any) => {
    setBranch(row.branch)
    setMonth(row.month)
    setForm({
      card_sales: row.card_sales || 0,
      pay_sales: row.pay_sales || 0,
      cash_sales: row.cash_sales || 0,
      account_sales: row.account_sales || 0,
      visitors: row.visitors || 0,
      reviews: row.reviews || 0,
      pass_paid: row.pass_paid || 0,
      pass_used: row.pass_used || 0,
    })
    setMergeCount(1)
    setMergedRows([row])
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  useEffect(() => {
    loadRecent()
  }, [])

  return (
    <main className="max-w-3xl mx-auto p-6 space-y-8">
      <h1 className="text-2xl font-bold">📅 미용실 월별 데이터 입력</h1>

      {/* 지점 / 월 선택 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label>지점</label>
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="border rounded w-full p-2"
          >
            <option value="">--선택--</option>
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </div>
        <div>
          <label>월 선택</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="border rounded w-full p-2"
          />
        </div>
      </div>

      {loading && (
        <p className="text-gray-500 text-center">⏳ 데이터 불러오는 중...</p>
      )}

      {/* 매출 입력 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label>카드매출</label>
          <input
            type="number"
            value={form.card_sales}
            onChange={(e) =>
              setForm({ ...form, card_sales: +e.target.value })
            }
            className="border rounded w-full p-2"
          />
        </div>
        <div>
          <label>페이매출</label>
          <input
            type="number"
            value={form.pay_sales}
            onChange={(e) => setForm({ ...form, pay_sales: +e.target.value })}
            className="border rounded w-full p-2"
          />
        </div>
        <div>
          <label>현금매출</label>
          <input
            type="number"
            value={form.cash_sales}
            onChange={(e) =>
              setForm({ ...form, cash_sales: +e.target.value })
            }
            className="border rounded w-full p-2"
          />
        </div>
        <div>
          <label>계좌이체매출</label>
          <input
            type="number"
            value={form.account_sales}
            onChange={(e) =>
              setForm({ ...form, account_sales: +e.target.value })
            }
            className="border rounded w-full p-2"
          />
        </div>
      </div>

      {/* 총매출 */}
      <div className="border-t pt-3">
        <label className="font-semibold">총 매출 합계</label>
        <input
          readOnly
          value={`${totalSales.toLocaleString()}${
            mergeCount > 1 ? ` (${mergeCount}건 합산됨)` : ''
          }`}
          className="border rounded w-full p-2 bg-gray-100 text-right font-semibold"
        />
      </div>

      {/* ✅ 합산된 세부 항목 표시 */}
      {mergeCount > 1 && mergedRows.length > 0 && (
        <div className="border rounded p-4 bg-gray-50 mt-3">
          <h3 className="font-semibold mb-2">📋 합산된 세부 항목 ({mergeCount}건)</h3>
          <table className="w-full text-sm border border-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 border">No</th>
                <th className="p-2 border">총매출</th>
                <th className="p-2 border">정액권 결제</th>
                <th className="p-2 border">정액권 차감</th>
                <th className="p-2 border">방문객</th>
                <th className="p-2 border">리뷰</th>
              </tr>
            </thead>
            <tbody>
              {mergedRows.map((r, i) => (
                <tr key={r.id || i}>
                  <td className="border p-2 text-center">{i + 1}</td>
                  <td className="border p-2 text-right">{(r.total_sales || 0).toLocaleString()}</td>
                  <td className="border p-2 text-right">{(r.pass_paid || 0).toLocaleString()}</td>
                  <td className="border p-2 text-right">{(r.pass_used || 0).toLocaleString()}</td>
                  <td className="border p-2 text-center">{r.visitors}</td>
                  <td className="border p-2 text-center">{r.reviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 방문객 / 리뷰 */}
      <div className="grid grid-cols-2 gap-4 pt-4">
        <div>
          <label>방문객 수</label>
          <input
            type="number"
            value={form.visitors}
            onChange={(e) => setForm({ ...form, visitors: +e.target.value })}
            className="border rounded w-full p-2"
          />
        </div>
        <div>
          <label>리뷰 수</label>
          <input
            type="number"
            value={form.reviews}
            onChange={(e) => setForm({ ...form, reviews: +e.target.value })}
            className="border rounded w-full p-2"
          />
        </div>
      </div>

      {/* 정액권 */}
      <div className="border-t pt-4 space-y-3">
        <h2 className="font-semibold text-lg">🧾 정액권 내역</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label>정액권 결제 금액</label>
            <input
              type="number"
              value={form.pass_paid}
              onChange={(e) =>
                setForm({ ...form, pass_paid: +e.target.value })
              }
              className="border rounded w-full p-2"
            />
          </div>
          <div>
            <label>정액권 차감 금액(실사용)</label>
            <input
              type="number"
              value={form.pass_used}
              onChange={(e) =>
                setForm({ ...form, pass_used: +e.target.value })
              }
              className="border rounded w-full p-2"
            />
          </div>
          <div>
            <label>정액권 잔액 (자동 계산)</label>
            <input
              readOnly
              value={passBalance.toLocaleString()}
              className="border rounded w-full p-2 bg-gray-100"
            />
          </div>
        </div>
      </div>

      {/* 저장 버튼 */}
      <button
        onClick={handleSave}
        disabled={loading}
        className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80 disabled:opacity-40"
      >
        {loading ? '저장 중...' : '저장하기'}
      </button>

      {saved && <p className="text-green-600 text-center">✅ 저장 완료!</p>}

      {/* 최근 저장 리스트 */}
      <section className="border-t pt-6">
        <h2 className="text-xl font-semibold mb-3">📋 최근 저장 내역</h2>

        {loadingList ? (
          <p className="text-gray-500 text-center">불러오는 중...</p>
        ) : recentData.length === 0 ? (
          <p className="text-gray-500 text-center">
            저장된 데이터가 없습니다.
          </p>
        ) : (
          <table className="w-full text-sm border border-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 border">지점</th>
                <th className="p-2 border">월</th>
                <th className="p-2 border">총매출</th>
                <th className="p-2 border">방문객</th>
                <th className="p-2 border">리뷰</th>
                <th className="p-2 border">정액권 잔액</th>
                <th className="p-2 border">수정일</th>
                <th className="p-2 border">삭제</th>
              </tr>
            </thead>
            <tbody>
              {recentData.map((row) => (
                <tr
                  key={row.id}
                  className="text-center hover:bg-gray-50 cursor-pointer transition"
                  onClick={() => handleRowClick(row)}
                >
                  <td className="border p-2">{row.branch}</td>
                  <td className="border p-2">{row.month}</td>
                  <td className="border p-2">
                    {(row.total_sales || 0).toLocaleString()}
                  </td>
                  <td className="border p-2">{row.visitors}</td>
                  <td className="border p-2">{row.reviews}</td>
                  <td className="border p-2">
                    {(row.pass_balance || 0).toLocaleString()}
                  </td>
                  <td className="border p-2 text-gray-500 text-xs">
                    {new Date(row.updated_at).toLocaleDateString()}
                  </td>
                  <td className="border p-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(row.id)
                      }}
                      className="text-red-600 hover:underline text-xs"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}