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
}

const KRW = (n: number = 0) =>
  (n ?? 0).toLocaleString('ko-KR', { style: 'currency', currency: 'KRW' })

export default function ManualSalaryPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [rows, setRows] = useState<DesignerInput[]>([])
  const [loading, setLoading] = useState(false)

  // ✅ 인건비 입력용 기간 상태
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')

  // ✅ 조회용 상태 (하단 테이블)
  const [listStartMonth, setListStartMonth] = useState('')
  const [listEndMonth, setListEndMonth] = useState('')
  const [listRows, setListRows] = useState<any[]>([])
  const [listLoading, setListLoading] = useState(false)

  // ✅ 지점 목록 불러오기
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()
        const res = await fetch(`${API_BASE}/meta/branches`, { headers, credentials: 'include' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const json = await res.json()
        setBranches(Array.isArray(json) ? json : [])
      } catch (err) {
        console.warn('branches 불러오기 실패:', err)
        setBranches([])
      }
    }
    loadBranches()
  }, [])

  // ✅ 행 추가
  const addRow = () => {
    setRows(prev => [
      ...prev,
      {
        name: '',
        rank: '디자이너',
        base: 0,
        extra: 0,
        sales: 0,
        month: new Date().toISOString().slice(0, 7),
      },
    ])
  }

  // ✅ 행 삭제
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx))

  // ✅ 행 업데이트
  const updateRow = (idx: number, field: keyof DesignerInput, value: any) => {
    setRows(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: value }
      return copy
    })
  }

  // ✅ 총급여 계산
  const totalSalary = (r: DesignerInput) => r.base + (r.extra || 0)
  const totalAll = useMemo(() => rows.reduce((sum, r) => sum + totalSalary(r), 0), [rows])
  const [autoLoading, setAutoLoading] = useState(false)
  // ✅ 자동 불러오기 (수정 버전)
  const handleAutoLoad = async () => {
    if (!branch || !startMonth || !endMonth)
      return alert('지점과 기간을 모두 선택하세요.')

    setAutoLoading(true) // ✅ 변경
    try {
      const headers = await apiAuthHeader()
      const res = await fetch(
        `${API_BASE}/transactions/salary_auto_load?branch=${encodeURIComponent(branch)}&start=${startMonth}&end=${endMonth}`,
        { headers, credentials: 'include' }
      )

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!Array.isArray(data)) return alert('조회된 데이터가 없습니다.')

      const mapped = data.map((r: any) => ({
        name: r.name || '이름없음',
        rank: r.rank || '디자이너',
        base: Number(r.base || 0),
        extra: 0, // ✅ 월급만이므로 항상 0
        sales: Number(r.sales || 0),
        month: r.month || new Date().toISOString().slice(0, 7),
      }))

      setRows(mapped)
      alert('✅ 자동 불러오기 완료! (필요 시 수정 후 저장하세요)')
    } catch (err) {
      console.error(err)
      alert('❌ 자동 불러오기 실패')
    } finally {
      setAutoLoading(false) // ✅ 변경
    }
  }

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

  // ✅ 합계
  const listTotal = useMemo(
    () => listRows.reduce((sum, r) => sum + (Number(r.total_amount) || Number(r.amount) || 0), 0),
    [listRows]
  )

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

      {/* 인건비 입력 */}
      {branch && (
        <section className="border rounded-lg p-4 bg-white space-y-4">
          {/* 필터 + 버튼 */}
          <div className="flex flex-wrap gap-3 items-end justify-between">
            <div className="flex gap-3">
              <div>
                <label className="block text-xs text-gray-500">시작 월</label>
                <input
                  type="month"
                  value={startMonth}
                  onChange={e => setStartMonth(e.target.value)}
                  className="border rounded px-2 py-1"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500">종료 월</label>
                <input
                  type="month"
                  value={endMonth}
                  onChange={e => setEndMonth(e.target.value)}
                  className="border rounded px-2 py-1"
                />
              </div>
              <button
                onClick={handleAutoLoad}
                disabled={autoLoading}
                className="bg-purple-600 text-white px-3 py-1 rounded"
              >
                {autoLoading ? '불러오는 중...' : '⚙️ 자동 불러오기'}
              </button>
            </div>
            <button
              onClick={addRow}
              className="bg-blue-600 text-white px-3 py-1 rounded"
            >
              + 행 추가
            </button>
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">이름</th>
                  <th className="border p-2">직급</th>
                  <th className="border p-2 text-right">월급</th>
                  <th className="border p-2 text-right">추가금</th>
                  <th className="border p-2 text-right">월매출</th>
                  <th className="border p-2">월</th>
                  <th className="border p-2 text-right">총급여</th>
                  <th className="border p-2">삭제</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-4 text-gray-500">
                      아직 데이터가 없습니다. 자동 불러오기 또는 행 추가를 이용하세요.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2">
                        <input
                          type="text"
                          value={r.name}
                          onChange={e => updateRow(i, 'name', e.target.value)}
                          className="border rounded px-2 py-1 w-full"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={r.rank}
                          onChange={e => updateRow(i, 'rank', e.target.value as Rank)}
                          className="border rounded px-2 py-1 w-full"
                        >
                          {RANKS.map(rank => (
                            <option key={rank}>{rank}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={r.base}
                          onChange={e => updateRow(i, 'base', Number(e.target.value))}
                          className="border rounded px-2 py-1 w-full text-right"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={r.extra}
                          onChange={e => updateRow(i, 'extra', Number(e.target.value))}
                          className="border rounded px-2 py-1 w-full text-right"
                        />
                      </td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          value={r.sales}
                          onChange={e => updateRow(i, 'sales', Number(e.target.value))}
                          className="border rounded px-2 py-1 w-full text-right"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="month"
                          value={r.month}
                          onChange={e => updateRow(i, 'month', e.target.value)}
                          className="border rounded px-2 py-1"
                        />
                      </td>
                      <td className="p-2 text-right font-semibold text-blue-700">
                        {KRW(totalSalary(r))}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => removeRow(i)}
                          className="text-red-600 underline text-xs"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 합계 & 저장 */}
          <div className="flex justify-between items-center">
            <div className="text-sm">
              합계: <b className="text-blue-700">{KRW(totalAll)}</b>
            </div>
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

      {/* ✅ 조회 섹션 */}
      {branch && (
        <section className="border rounded-lg p-4 bg-gray-50 space-y-4">
          <h2 className="font-semibold text-lg">📊 월별 급여 조회</h2>

          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-sm text-gray-600">시작 월</label>
              <input
                type="month"
                value={listStartMonth}
                onChange={e => setListStartMonth(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600">종료 월</label>
              <input
                type="month"
                value={listEndMonth}
                onChange={e => setListEndMonth(e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
            <button
              onClick={handleFetchList}
              disabled={listLoading}
              className="bg-black text-white px-3 py-1 rounded"
            >
              {listLoading ? '조회 중...' : '조회'}
            </button>
          </div>

          {listRows.length > 0 ? (
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
                    <th className="border p-2">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {listRows.map((r, i) => (
                    <tr key={i}>
                      <td className="p-2">{r.month}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2">{r.rank || '-'}</td>
                      <td className="p-2 text-right">{KRW(r.base_amount || 0)}</td>
                      <td className="p-2 text-right">{KRW(r.extra_amount || 0)}</td>
                      <td className="p-2 text-right font-semibold text-blue-700">
                        {KRW(r.total_amount || r.amount || 0)}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          onClick={() => handleDeleteRow(r)}
                          className="text-red-600 underline text-xs hover:text-red-800"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="text-right text-sm mt-3">
                합계: <b className="text-blue-700">{KRW(listTotal)}</b>
              </div>
            </div>
          ) : (
            !listLoading && <p className="text-gray-500 text-center p-4">조회 결과 없음</p>
          )}
        </section>
      )}
    </main>
  )
}