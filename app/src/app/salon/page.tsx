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
    reviews: 0
  })
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const loadBranches = async () => {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/meta/branches`, { headers, credentials: 'include' })
      const json = await res.json()
      setBranches(Array.isArray(json) ? json : [])
    }
    loadBranches()
  }, [])

  const handleSave = async () => {
    if (!branch || !month) return alert('지점과 월을 선택하세요.')
    const user = (await supabase.auth.getUser()).data.user
    if (!user) return alert('로그인 필요')

    const { error } = await supabase
      .from('salon_monthly_data')
      .upsert({
        user_id: user.id,
        branch,
        month,
        ...form,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,branch,month' })

    if (error) alert('저장 실패: ' + error.message)
    else setSaved(true)
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">📅 미용실 월별 데이터 입력</h1>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label>지점</label>
          <select value={branch} onChange={e => setBranch(e.target.value)} className="border rounded w-full p-2">
            <option value="">--선택--</option>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label>월 선택</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border rounded w-full p-2" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label>카드매출</label><input type="number" value={form.card_sales} onChange={e => setForm({...form,card_sales:+e.target.value})} className="border rounded w-full p-2" /></div>
        <div><label>페이매출</label><input type="number" value={form.pay_sales} onChange={e => setForm({...form,pay_sales:+e.target.value})} className="border rounded w-full p-2" /></div>
        <div><label>현금매출</label><input type="number" value={form.cash_sales} onChange={e => setForm({...form,cash_sales:+e.target.value})} className="border rounded w-full p-2" /></div>
        <div><label>계좌이체매출</label><input type="number" value={form.account_sales} onChange={e => setForm({...form,account_sales:+e.target.value})} className="border rounded w-full p-2" /></div>
        <div><label>방문객 수</label><input type="number" value={form.visitors} onChange={e => setForm({...form,visitors:+e.target.value})} className="border rounded w-full p-2" /></div>
        <div><label>리뷰 수</label><input type="number" value={form.reviews} onChange={e => setForm({...form,reviews:+e.target.value})} className="border rounded w-full p-2" /></div>
      </div>

      <button onClick={handleSave} className="w-full bg-black text-white py-3 rounded-lg hover:opacity-80">
        저장하기
      </button>

      {saved && <p className="text-green-600 text-center">✅ 저장 완료!</p>}
    </main>
  )
}