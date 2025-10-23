'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { API_BASE, apiAuthHeader } from '@/lib/api' // ✅ apiAuthHeader import
import {
  LineChart, Line, Tooltip, XAxis, YAxis, ResponsiveContainer, Legend
} from 'recharts'

const formatCurrency = (n: number) =>
  (n ?? 0).toLocaleString('ko-KR', { style: 'currency', currency: 'KRW' })

const formatShortNumber = (num: number) => {
  if (num == null) return '0'
  const abs = Math.abs(num)
  if (abs >= 1_000_000_000) return (num / 1_000_000_000).toFixed(1) + 'B'
  if (abs >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (num / 1_000).toFixed(1) + 'K'
  return String(num)
}

export default function AssetsPage() {
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [liquidAssets, setLiquidAssets] = useState<any[]>([])
  const [assetLogs, setAssetLogs] = useState<any[]>([])
  const [liquidCats, setLiquidCats] = useState<string[]>([])
  const [fixedCats, setFixedCats] = useState<string[]>([])
  const [assetInput, setAssetInput] = useState({
    type: '수입',
    direction: '증가',
    category: '',
    amount: '',
    memo: '',
  })

  /* ===== Branch 목록 ===== */
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader() // ✅ 추가
        const res = await fetch(`${API_BASE}/meta/branches`, {
          headers,
          credentials: 'include'
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

  /* ===== 자산 카테고리 ===== */
  useEffect(() => {
    const fetchAssetCategories = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) return

      const { data, error } = await supabase
        .from('categories')
        .select('name, type')
        .eq('user_id', userId)
        .in('type', ['유동자산', '부동자산'])

      if (error) {
        console.error('❌ 자산 카테고리 불러오기 실패:', error)
        return
      }

      setLiquidCats(data.filter((c: any) => c.type === '유동자산').map((c: any) => c.name))
      setFixedCats(data.filter((c: any) => c.type === '부동자산').map((c: any) => c.name))
    }

    fetchAssetCategories()
  }, [])

  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')
  const [filteredLiquidAssets, setFilteredLiquidAssets] = useState<any[]>([])

  // 💧 유동자산 필터링
  const filterByMonthRange = () => {
    if (!startMonth || !endMonth) {
      setFilteredLiquidAssets(liquidAssets)
      return
    }

    const start = startMonth.replace('-', '')
    const end = endMonth.replace('-', '')

    const filtered = liquidAssets.filter(r => {
      const key = r.month.replace('-', '')
      return key >= start && key <= end
    })

    setFilteredLiquidAssets(filtered)
  }

  useEffect(() => {
    if (liquidAssets.length > 0) {
      setStartMonth(liquidAssets[0].month)
      setEndMonth(liquidAssets[liquidAssets.length - 1].month)
      setFilteredLiquidAssets(liquidAssets)
    }
  }, [liquidAssets])

  /* ===== 유동자산 (자동) ===== */
  const loadLiquidAssets = async () => {
    try {
      const headers = await apiAuthHeader() // ✅ 추가
      const res = await fetch(`${API_BASE}/assets_log/liquid?branch=${encodeURIComponent(branch)}`, {
        headers,
        credentials: 'include'
      })
      const json = await res.json()
      const items = json.items || []

      const grouped: Record<string, number> = {}
      items.forEach((r: any) => {
        const d = new Date(r.created_at)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        grouped[key] = r.amount
      })

      const months = Object.keys(grouped).sort()
      const formatted = months.map((month, i) => {
        const prev = i > 0 ? grouped[months[i - 1]] : grouped[month]
        const diff = grouped[month] - prev
        return { month, balance: grouped[month], diff }
      })

      setLiquidAssets(formatted)
    } catch (e) {
      console.error('유동자산 불러오기 실패', e)
    }
  }

  /* ===== 부동자산 (수동 등록/삭제) ===== */
  const loadAssets = async () => {
    try {
      const headers = await apiAuthHeader() // ✅ 추가
      const res = await fetch(`${API_BASE}/assets_log?branch=${encodeURIComponent(branch)}`, {
        headers,
        credentials: 'include'
      })
      const json = await res.json()
      setAssetLogs((json.items || []).filter((r: any) => !r.memo?.includes('자동등록')))
    } catch {
      setAssetLogs([])
    }
  }

  const saveAsset = async () => {
    if (!assetInput.category || !assetInput.amount) return alert('카테고리와 금액을 입력하세요.')

    const headers = await apiAuthHeader() // ✅ 추가
    const payload = {
      type: assetInput.type,
      direction: assetInput.direction,
      category: assetInput.category,
      amount: Number(assetInput.amount),
      memo: assetInput.memo || '',
      branch,
    }

    const res = await fetch(`${API_BASE}/assets_log`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const msg = await res.text()
      console.error('❌ 자산 저장 실패:', msg)
      alert('저장 실패')
      return
    }

    alert('저장 완료')
    setAssetInput({ type: '수입', direction: '증가', category: '', amount: '', memo: '' })
    loadAssets()
  }

  const deleteAsset = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const headers = await apiAuthHeader() // ✅ 추가
    const res = await fetch(`${API_BASE}/assets_log/${id}`, {
      method: 'DELETE',
      headers,
      credentials: 'include'
    })
    if (res.ok) await loadAssets()
    else alert('삭제 실패')
  }

  useEffect(() => {
    if (!branch) return
    loadLiquidAssets()
    loadAssets()
  }, [branch])

  /* ===== 그래프 데이터 ===== */
  const assetByCategoryGraph = useMemo(() => {
    const grouped: Record<string, Record<string, number>> = {}
    assetLogs.forEach(log => {
      if (log.direction === '유지') return
      const category = log.category || '미분류'
      const date = new Date(log.created_at).toISOString().split('T')[0]
      const sign = log.direction === '감소' ? -1 : 1
      if (!grouped[category]) grouped[category] = {}
      grouped[category][date] = (grouped[category][date] || 0) + sign * (log.amount || 0)
    })
    const result: Record<string, { date: string; amount: number }[]> = {}
    Object.entries(grouped).forEach(([cat, dateObj]) => {
      const sorted = Object.entries(dateObj)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, amount]) => ({ date, amount }))
      result[cat] = sorted
    })
    return result
  }, [assetLogs])

  const totalAssets = useMemo(() => {
    return assetLogs.reduce((sum, cur) => {
      if (cur.direction === '유지') return sum
      const sign = cur.direction === '감소' ? -1 : 1
      return sum + sign * (cur.amount || 0)
    }, 0)
  }, [assetLogs])

  return (
    <main className="p-6 space-y-10 bg-gray-100 min-h-screen">
      <header className="flex flex-wrap items-end gap-3">
        <h1 className="text-2xl font-bold">🏦 자산 관리</h1>
      </header>

      {/* === 필터 바 === */}
      <section className="border rounded-xl p-4 bg-white shadow-sm flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs text-gray-500">지점</label>
          <select
            className="border rounded px-3 py-2"
            value={branch}
            onChange={e => setBranch(e.target.value)}
          >
            <option value="">지점을 선택하세요</option>
            {branches.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
      </section>

{/* 💧 유동자산 관리 (자동) */}
{branch && (
  <section className="bg-white rounded-xl border shadow-sm p-6 space-y-6">
    <div className="flex flex-wrap items-center justify-between">
      <div>
        <h2 className="text-xl font-semibold text-blue-700">💧 유동자산 관리 (자동 업데이트)</h2>
        <p className="text-sm text-gray-500">업로드된 거래 파일의 월말 잔액을 기준으로 월별 증감 추이를 표시합니다.</p>
      </div>

      {/* 🔍 월 필터 */}
      {liquidAssets.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-600">기간:</label>
          <input
            type="month"
            className="border rounded px-2 py-1"
            value={liquidAssets.length > 0 ? liquidAssets[0].month : ''}
            onChange={(e) => setStartMonth(e.target.value)}
          />
          <span>~</span>
          <input
            type="month"
            className="border rounded px-2 py-1"
            value={endMonth}
            onChange={(e) => setEndMonth(e.target.value)}
          />
          <button
            onClick={filterByMonthRange}
            className="ml-2 bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
          >
            적용
          </button>
        </div>
      )}
    </div>

    {/* 그래프 */}
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={filteredLiquidAssets}>
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={(v) => v.toLocaleString()} />
          <Tooltip formatter={(v: number) => `${v.toLocaleString()}원`} />
          <Legend />
          <Line
            type="monotone"
            dataKey="balance"
            name="월말 잔액"
            stroke="#2563eb"
            strokeWidth={3}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="diff"
            name="전월 대비 증감"
            stroke="#22c55e"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>

    {/* 표 */}
    <div className="overflow-x-auto">
      <table className="w-full text-sm border border-gray-200 rounded-lg">
        <thead className="bg-gray-50">
          <tr>
            <th className="p-2 border">월</th>
            <th className="p-2 border text-right">월초 잔액(매월 1일)</th>
            <th className="p-2 border text-right">전월 대비 증감</th>
          </tr>
        </thead>
        <tbody>
          {filteredLiquidAssets.length > 0 ? filteredLiquidAssets.map((r, i) => (
            <tr key={i} className="border-t">
              <td className="p-2">{r.month}</td>
              <td className="p-2 text-right">{formatCurrency(r.balance)}</td>
              <td className={`p-2 text-right ${r.diff >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {r.diff >= 0 ? '+' : ''}{formatCurrency(r.diff)}
              </td>
            </tr>
          )) : (
            <tr><td colSpan={3} className="text-center text-gray-400 p-3">선택한 기간의 유동자산 데이터 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  </section>
)}
      {/* 🏠 부동자산 관리 (수동) */}
      {branch && (
        <section className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">🏠 부동자산 관리</h2>
              <p className="text-sm text-gray-500 mt-1">
                총 자산 합계: <span className="text-amber-700 font-semibold">{formatCurrency(totalAssets)}</span>
              </p>
            </div>

            <div className="flex gap-2">
              <select
                className="border rounded px-2 py-1 text-sm"
                value={assetInput.type}
                onChange={e => setAssetInput({ ...assetInput, type: e.target.value })}
              >
                <option value="수입">수입</option>
                <option value="지출">지출</option>
              </select>

              <select
                className="border rounded px-2 py-1 text-sm"
                value={assetInput.direction}
                onChange={e => setAssetInput({ ...assetInput, direction: e.target.value })}
              >
                <option value="증가">자본 증가</option>
                <option value="감소">자본 감소</option>
                <option value="유지">자본 그대로</option>
              </select>

              <select
                className="border rounded px-2 py-1 text-sm w-40"
                value={assetInput.category}
                onChange={e => setAssetInput({ ...assetInput, category: e.target.value })}
              >
                <option value="">카테고리 선택</option>
                <optgroup label="유동자산">
                  {liquidCats.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </optgroup>
                <optgroup label="부동자산">
                  {fixedCats.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </optgroup>
              </select>

              <input
                type="number"
                className="border rounded px-2 py-1 text-sm w-28"
                placeholder="금액"
                value={assetInput.amount}
                onChange={e => setAssetInput({ ...assetInput, amount: e.target.value })}
              />
              <input
                type="text"
                className="border rounded px-2 py-1 text-sm w-48"
                placeholder="메모(선택)"
                value={assetInput.memo}
                onChange={e => setAssetInput({ ...assetInput, memo: e.target.value })}
              />
              <button onClick={saveAsset} className="bg-amber-600 text-white rounded px-3 py-1 text-sm">
                저장
              </button>
            </div>
          </header>

          <div className="grid sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Object.entries(assetByCategoryGraph).map(([category, items], i) => (
              <div key={i} className="p-3 bg-gray-50 border rounded-lg">
                <h3 className="text-sm font-semibold text-gray-800 mb-1">{category}</h3>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={items}>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tickFormatter={formatShortNumber} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Line type="monotone" dataKey="amount" name='금액' stroke="#f59e0b" dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 border">날짜</th>
                  <th className="p-2 border">유형</th>
                  <th className="p-2 border">자본</th>
                  <th className="p-2 border">카테고리</th>
                  <th className="p-2 border text-right">금액</th>
                  <th className="p-2 border">메모</th>
                  <th className="p-2 border">삭제</th>
                </tr>
              </thead>
              <tbody>
                {assetLogs.length > 0 ? assetLogs.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className={`p-2 font-semibold ${r.type === '지출' ? 'text-red-600' : 'text-green-600'}`}>{r.type}</td>
                    <td className={`p-2 ${r.direction === '감소' ? 'text-red-600' : r.direction === '유지' ? 'text-gray-500' : 'text-blue-600'}`}>{r.direction}</td>
                    <td className="p-2">{r.category || '미분류'}</td>
                    <td className="p-2 text-right text-gray-700">{formatCurrency(r.amount)}</td>
                    <td className="p-2">{r.memo || '-'}</td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => deleteAsset(r.id)}
                        className="text-xs text-red-500 hover:text-red-700 underline"
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} className="text-center text-gray-400 p-3">입력된 자산 내역 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}