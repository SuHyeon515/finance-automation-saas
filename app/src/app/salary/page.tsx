'use client'

import { useEffect, useState, useMemo } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'

const RANKS = ['인턴', '디자이너', '실장', '부원장', '매니저', '대표원장', '대표'] as const
type Rank = typeof RANKS[number]

type DesignerInput = {
  name: string
  rank: Rank
  base: number
  extra: number
  sales: number
  month: string
  _count?: number
  _details?: any[]
}

const KRW = (n: number = 0) =>
  (n ?? 0).toLocaleString('ko-KR', { style: 'currency', currency: 'KRW' })

export default function ManualSalaryPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [rows, setRows] = useState<DesignerInput[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({}) // ✅ 토글 상태

  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')

  const [autoLoading, setAutoLoading] = useState(false)
  const [listStartMonth, setListStartMonth] = useState('')
  const [listEndMonth, setListEndMonth] = useState('')
  const [listRows, setListRows] = useState<any[]>([])
  const [listLoading, setListLoading] = useState(false)

  // ✅ 지점 목록
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

  // ✅ 자동 불러오기 + 이름별 합산 + 세부 항목
  const handleAutoLoad = async () => {
    if (!branch || !startMonth || !endMonth)
      return alert('지점과 기간을 모두 선택하세요.')

    setAutoLoading(true)
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(
        `${API_BASE}/transactions/salary_auto_load?branch=${encodeURIComponent(branch)}&start=${startMonth}&end=${endMonth}`,
        { headers, credentials: 'include' }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0)
        return alert('조회된 데이터가 없습니다.')

      // ✅ 이름 기준 그룹화
      const grouped: Record<string, any[]> = {}
      data.forEach((d) => {
        const name = d.name || '이름없음'
        if (!grouped[name]) grouped[name] = []
        grouped[name].push(d)
      })

      const merged: DesignerInput[] = Object.entries(grouped).map(([name, arr]) => {
        const totalBase = arr.reduce((sum, i) => sum + Number(i.base || i.amount || 0), 0)
        const totalSales = arr.reduce((sum, i) => sum + Number(i.sales || 0), 0)
        return {
          name,
          rank: arr[0].rank || '디자이너',
          base: totalBase,
          extra: 0,
          sales: totalSales,
          month: arr[0].month || startMonth,
          _count: arr.length,
          _details: arr,
        }
      })

      setRows(merged)
      alert(`✅ 자동 불러오기 완료 (${data.length}건 → ${merged.length}명 합산됨)`)
    } catch (err) {
      console.error(err)
      alert('❌ 자동 불러오기 실패')
    } finally {
      setAutoLoading(false)
    }
  }

  // ✅ 합계
  const totalSalary = (r: DesignerInput) => r.base + (r.extra || 0)
  const totalAll = useMemo(() => rows.reduce((sum, r) => sum + totalSalary(r), 0), [rows])

  // ✅ 저장
  const handleSave = async () => {
    if (!branch) return alert('지점을 선택하세요.')
    if (rows.length === 0) return alert('입력된 항목이 없습니다.')

    setLoading(true)
    try {
      const payload = rows.map(r => ({
        branch,
        name: r.name,
        rank: r.rank,
        month: r.month,
        base_amount: r.base,
        extra_amount: r.extra,
        sales_amount: r.sales,
        total_amount: totalSalary(r),
      }))

      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/transactions/salary_manual_save`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      if (res.ok) alert('✅ 급여 데이터 저장 완료')
      else alert('❌ 저장 실패')
    } catch (err) {
      console.error(err)
      alert('❌ 서버 오류')
    } finally {
      setLoading(false)
    }
  }

  // ✅ 조회
  const handleFetchList = async () => {
    if (!branch || !listStartMonth || !listEndMonth)
      return alert('지점과 조회 기간을 선택하세요.')

    setListLoading(true)
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(
        `${API_BASE}/designer_salaries?branch=${encodeURIComponent(branch)}&start_month=${listStartMonth}&end_month=${listEndMonth}`,
        { headers, credentials: 'include' }
      )
      const data = await res.json()
      setListRows(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error(e)
      alert('❌ 조회 실패')
    } finally {
      setListLoading(false)
    }
  }

  // ✅ 삭제
  const handleDeleteRow = async (row: any) => {
    if (!confirm(`${row.name} (${row.month}) 급여 데이터를 삭제하시겠습니까?`)) return
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(`${API_BASE}/transactions/salary_manual_delete`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ branch, name: row.name, month: row.month }),
      })
      if (res.ok) {
        alert('🗑️ 삭제 완료')
        setListRows(prev => prev.filter(r => !(r.name === row.name && r.month === row.month)))
      } else alert('❌ 삭제 실패')
    } catch (err) {
      console.error(err)
      alert('❌ 서버 오류')
    }
  }

  const listTotal = useMemo(
    () => listRows.reduce((sum, r) => sum + (Number(r.total_amount) || Number(r.amount) || 0), 0),
    [listRows]
  )

  // ✅ UI
  return (
    <main className="p-6 max-w-5xl mx-auto space-y-10">
      <h1 className="text-2xl font-bold mb-2">💵 인건비 입력 + 자동 불러오기</h1>

      {/* 지점 선택 */}
      <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
        <label className="block text-sm font-medium">🏢 지점 선택</label>
        <select
          value={branch}
          onChange={e => setBranch(e.target.value)}
          className="border rounded px-3 py-2 w-full bg-white"
        >
          <option value="">-- 지점을 선택하세요 --</option>
          {branches.map(b => (
            <option key={b}>{b}</option>
          ))}
        </select>
      </section>

      {/* 입력 섹션 */}
      {branch && (
        <section className="border rounded-lg p-4 bg-white space-y-4">
          <div className="flex gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500">시작 월</label>
              <input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} className="border rounded px-2 py-1" />
            </div>
            <div>
              <label className="block text-xs text-gray-500">종료 월</label>
              <input type="month" value={endMonth} onChange={e => setEndMonth(e.target.value)} className="border rounded px-2 py-1" />
            </div>
            <button onClick={handleAutoLoad} disabled={autoLoading} className="bg-purple-600 text-white px-3 py-1 rounded">
              {autoLoading ? '불러오는 중...' : '⚙️ 자동 불러오기'}
            </button>
          </div>

          {/* 합산표 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">이름</th>
                  <th className="border p-2">직급</th>
                  <th className="border p-2 text-right">월급</th>
                  <th className="border p-2 text-right">매출</th>
                  <th className="border p-2 text-right">총급여</th>
                  <th className="border p-2">세부</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <>
                    <tr key={i} className={r._count && r._count > 1 ? 'bg-blue-50' : ''}>
                      <td className="p-2 font-medium">
                        {r.name}{' '}
                        {r._count && r._count > 1 && (
                          <span className="text-xs text-gray-500">({r._count}건)</span>
                        )}
                      </td>
                      <td className="p-2">{r.rank}</td>
                      <td className="p-2 text-right">{KRW(r.base)}</td>
                      <td className="p-2 text-right">{KRW(r.sales)}</td>
                      <td className="p-2 text-right font-semibold text-blue-700">
                        {KRW(totalSalary(r))}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => setExpanded(p => ({ ...p, [r.name]: !p[r.name] }))}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          {expanded[r.name] ? '▲ 닫기' : '▼ 세부'}
                        </button>
                      </td>
                    </tr>

                    {expanded[r.name] && r._details && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="p-3">
                          <table className="w-full text-xs border">
                            <thead className="bg-gray-100">
                              <tr>
                                <th className="border p-1">항목</th>
                                <th className="border p-1 text-right">금액</th>
                                <th className="border p-1">월</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r._details.map((d, j) => (
                                <tr key={j}>
                                  <td className="border p-1 text-gray-700">
                                    {d.category || '기타'}
                                  </td>
                                  <td className="border p-1 text-right">
                                    {KRW(d.base || d.amount || 0)}
                                  </td>
                                  <td className="border p-1">{d.month}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-right font-semibold mt-3">
            합계: <span className="text-blue-700">{KRW(totalAll)}</span>
          </div>

          <div className="text-right">
            <button
              onClick={handleSave}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded hover:opacity-80"
            >
              {loading ? '저장 중...' : '✅ 전체 저장'}
            </button>
          </div>
        </section>
      )}

      {/* ✅ 조회 섹션 (생략 없이 유지) */}
      {branch && (
        <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
          <h2 className="font-semibold text-lg">📊 월별 급여 조회</h2>
          <div className="flex gap-3 items-end">
            <input type="month" value={listStartMonth} onChange={e => setListStartMonth(e.target.value)} className="border rounded px-2 py-1" />
            <input type="month" value={listEndMonth} onChange={e => setListEndMonth(e.target.value)} className="border rounded px-2 py-1" />
            <button onClick={handleFetchList} disabled={listLoading} className="bg-black text-white px-3 py-1 rounded">
              {listLoading ? '조회 중...' : '조회'}
            </button>
          </div>

          {listRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="border p-2">월</th>
                    <th className="border p-2">이름</th>
                    <th className="border p-2">직급</th>
                    <th className="border p-2 text-right">기본급</th>
                    <th className="border p-2 text-right">추가금</th>
                    <th className="border p-2 text-right">총급여</th>
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2">{r.month}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.rank}</td>
                      <td className="p-2 text-right">{KRW(r.base_amount)}</td>
                      <td className="p-2 text-right">{KRW(r.extra_amount)}</td>
                      <td className="p-2 text-right text-blue-700 font-semibold">
                        {KRW(r.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-right text-sm mt-2">
                총합: <b className="text-blue-700">{KRW(listTotal)}</b>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  )
}