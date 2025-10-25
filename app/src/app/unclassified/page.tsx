// @ts-nocheck
'use client'

export const dynamic = 'force-dynamic'  // ✅ 그대로 유지

import { Suspense } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { API_BASE } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

// ✅ 자동분류 룰 타입
type Rule = {
  id?: string
  keyword: string
  target: 'vendor' | 'description' | 'memo' | 'any'
  category: string
  is_fixed?: boolean
  priority?: number
}

/* ============================================================
   ✅ 내부 컴포넌트: 실제 동작 코드 (원래 내용 그대로 유지)
============================================================ */
function UnclassifiedInner() {
  const params = useSearchParams() // ✅ URL 쿼리 읽기용
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filterType, setFilterType] = useState<'all' | 'in' | 'out' | 'unclassified'>('all')
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const [branchList, setBranchList] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState<string>('')

  // ✅ 카테고리 목록
  const [incomeCats, setIncomeCats] = useState<string[]>([])
  const [fixedExpenseCats, setFixedExpenseCats] = useState<string[]>([])
  const [variableExpenseCats, setVariableExpenseCats] = useState<string[]>([])

  // ✅ Supabase 세션 확인
  useEffect(() => {
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) setAccessToken(session.access_token)
    }
    run()
  }, [])

  // ✅ URL 파라미터(branch, year, month) 자동 인식
  useEffect(() => {
    const branch = params.get('branch')
    const year = params.get('year')
    const month = params.get('month')
    if (branch) setSelectedBranch(branch)
    if (year && month) {
      const formatted = `${year}-${String(month).padStart(2, '0')}`
      setSelectedMonth(formatted)
    }
  }, [params])

  // ✅ 지점 목록 불러오기
  useEffect(() => {
    const fetchBranches = async () => {
      const { data, error } = await supabase.from('branches').select('name').order('name')
      if (error) {
        console.error('❌ branches 불러오기 실패:', error)
        return
      }
      setBranchList(data.map((b: any) => b.name))
    }
    fetchBranches()
  }, [])

  // ✅ 카테고리 불러오기
  useEffect(() => {
    const fetchCategories = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) return

      const { data, error } = await supabase
        .from('categories')
        .select('name, type')
        .eq('user_id', userId)

      if (error) {
        console.error('❌ categories 불러오기 실패:', error)
        return
      }

      const income = data.filter((c: any) => c.type === '수입').map((c: any) => c.name)
      const fixed = data.filter((c: any) => c.type === '고정지출').map((c: any) => c.name)
      const variable = data.filter((c: any) => c.type === '변동지출').map((c: any) => c.name)

      setIncomeCats(income)
      setFixedExpenseCats(fixed)
      setVariableExpenseCats(variable)
    }
    fetchCategories()
  }, [])

  // ✅ 거래 데이터 불러오기
  const load = async () => {
    if (!accessToken || !selectedBranch) return
    setLoading(true)
    try {
      const [txData, ruleList] = await Promise.all([
        fetch(`${API_BASE}/transactions/manage?branch=${encodeURIComponent(selectedBranch)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.json()),
        fetch(`${API_BASE}/rules`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.json()).catch(() => []),
      ])

      setRows(Array.isArray(txData?.items) ? txData.items : [])
      setRules(Array.isArray(ruleList) ? ruleList : (ruleList?.items || []))

      const months = Array.from(
        new Set((txData?.items || []).map((r: any) => r.tx_date?.slice(0, 7)))
      ).filter(Boolean)

      if (!selectedMonth)
        setSelectedMonth(months[0] || new Date().toISOString().slice(0, 7))
    } catch (e) {
      console.error(e)
      alert('데이터 불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  // ✅ 자동 로드
  useEffect(() => {
    if (accessToken && selectedBranch) load()
  }, [accessToken, selectedBranch])

  useEffect(() => {
    if (accessToken && selectedBranch && selectedMonth) load()
  }, [accessToken, selectedBranch, selectedMonth])

  // ✅ 월별 / 유형 필터
  const monthList = useMemo(() => {
    return Array.from(new Set(rows.map(r => r.tx_date?.slice(0, 7)))).filter(Boolean)
  }, [rows])

  const filteredRows = useMemo(() => {
    const arr = rows
      .filter(r => r.tx_date?.startsWith(selectedMonth))
      .sort((a, b) => new Date(a.tx_date).getTime() - new Date(b.tx_date).getTime())

    if (filterType === 'in')
      return arr.filter(r => Number(r.amount) > 0)
    if (filterType === 'out')
      return arr.filter(r => Number(r.amount) < 0)
    if (filterType === 'unclassified')
      return arr.filter(r => !r.category || r.category.trim() === '' || r.category === '미분류')
    return arr
  }, [rows, selectedMonth, filterType])

  const totals = useMemo(() => {
    const p = filteredRows.reduce((acc, r) => (Number(r.amount) > 0 ? acc + Number(r.amount) : acc), 0)
    const n = filteredRows.reduce((acc, r) => (Number(r.amount) < 0 ? acc + Number(r.amount) : acc), 0)
    return { inTotal: p, outTotal: n, net: p + n }
  }, [filteredRows])

  // ✅ 카테고리 + 메모 저장 함수
  const handleAssignWithMemo = async (txId: string, category: string, memo?: string) => {
    if (!txId) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/transactions/assign`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_ids: [txId],
          category: category || '',
          memo: memo || '',
          save_rule: false,
        }),
      })
      if (!res.ok) throw new Error('assign failed')

      setRows(prev =>
        prev.map(r =>
          r.id === txId ? { ...r, category, memo: memo || '', tempCategory: '' } : r
        )
      )
    } catch (e) {
      console.error(e)
      alert('카테고리 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  // ✅ 고정/변동 지출 지정
  const handleFixedChange = async (txId: string, isFixed: boolean) => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/transactions/mark_fixed`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transaction_id: txId, is_fixed: isFixed }),
      })
      if (!res.ok) throw new Error('mark_fixed failed')
      setRows(prev => prev.map(r => (r.id === txId ? { ...r, is_fixed: isFixed } : r)))
    } catch (e) {
      console.error(e)
      alert('지출 유형 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-xl font-bold">🧩 미분류 거래 관리 (고정/변동 지출 포함)</h1>

      {/* ✅ 필터 바 */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="border rounded px-2 py-1"
          value={selectedBranch}
          onChange={e => {
            setSelectedBranch(e.target.value)
            setSelectedMonth('')
          }}
        >
          <option value="">지점 선택</option>
          {branchList.map(branch => (
            <option key={branch} value={branch}>{branch}</option>
          ))}
        </select>

        {selectedBranch && (
          <select
            className="border rounded px-2 py-1"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {monthList.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        <div className="flex gap-2 ml-auto">
          <button onClick={() => setFilterType('all')}
            className={`px-3 py-1 rounded ${filterType === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-200'}`}>
            전체
          </button>
          <button onClick={() => setFilterType('in')}
            className={`px-3 py-1 rounded ${filterType === 'in' ? 'bg-green-600 text-white' : 'bg-gray-200'}`}>
            수입
          </button>
          <button onClick={() => setFilterType('out')}
            className={`px-3 py-1 rounded ${filterType === 'out' ? 'bg-red-600 text-white' : 'bg-gray-200'}`}>
            지출
          </button>
          <button onClick={() => setFilterType('unclassified')}
            className={`px-3 py-1 rounded flex items-center gap-1 ${filterType === 'unclassified' ? 'bg-yellow-500 text-white' : 'bg-gray-200'}`}>
            ⚠️ 미분류
          </button>
        </div>
      </div>

      <div className="text-sm text-right mt-2">
        💰 수입 <b className="text-green-600">{totals.inTotal.toLocaleString()}</b>원 ·{' '}
        지출 <b className="text-red-600">{totals.outTotal.toLocaleString()}</b>원 ·{' '}
        순이익 <b className="text-blue-600">{totals.net.toLocaleString()}</b>원
      </div>

      {loading && <p>불러오는 중...</p>}
      {!loading && filteredRows.length === 0 && <p>데이터 없음</p>}
      {!loading && filteredRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border border-gray-300 rounded-lg">
            <thead className="bg-gray-100 sticky top-0">
              <tr>
                <th className="p-2 border">날짜</th>
                <th className="p-2 border">내용</th>
                <th className="p-2 border text-right">금액</th>
                <th className="p-2 border">유형</th>
                <th className="p-2 border">카테고리</th>
                <th className="p-2 border">메모</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const isExpense = Number(r.amount) < 0
                const catList = isExpense
                  ? r.is_fixed
                    ? fixedExpenseCats
                    : variableExpenseCats
                  : incomeCats
                return (
                  <tr key={r.id} className="border-b align-top">
                    <td className="p-2">{r.tx_date}</td>
                    <td className="p-2">{r.description}</td>
                    <td className={`p-2 text-right font-semibold ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                      {Number(r.amount).toLocaleString()}원
                    </td>
                    <td className="p-2 text-center">{isExpense ? '지출' : '수입'}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {catList.map(cat => (
                          <button
                            key={cat}
                            className={`px-2 py-1 text-xs rounded border ${
                              r.category === cat
                                ? 'bg-indigo-600 text-white border-indigo-600'
                                : 'bg-gray-100 hover:bg-gray-200 border-gray-300'
                            }`}
                            onClick={() => handleAssignWithMemo(r.id, cat, r.memo)}
                            disabled={saving}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="메모 입력"
                            className="border rounded px-2 py-1 w-[180px]"
                            value={r.tempMemo ?? r.memo ?? ''}
                            onChange={e => {
                              const val = e.target.value
                              setRows(prev =>
                                prev.map(item =>
                                  item.id === r.id ? { ...item, tempMemo: val } : item
                                )
                              )
                            }}
                          />
                          <button
                            className="px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-300"
                            onClick={() => {
                              const memo = (r.tempMemo || '').trim()
                              handleAssignWithMemo(r.id, r.category || '', memo)
                            }}
                            disabled={saving}
                          >
                            저장
                          </button>
                          {r.memo && (
                            <button
                              className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:bg-gray-300"
                              onClick={() => handleAssignWithMemo(r.id, r.category || '', '')}
                              disabled={saving}
                            >
                              삭제
                            </button>
                          )}
                        </div>

                        {isExpense && (
                          <div className="flex gap-2 text-xs mt-1">
                            <button
                              onClick={() => handleFixedChange(r.id, true)}
                              className={`px-2 py-1 rounded ${r.is_fixed ? 'bg-orange-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                              disabled={saving}
                            >
                              고정지출
                            </button>
                            <button
                              onClick={() => handleFixedChange(r.id, false)}
                              className={`px-2 py-1 rounded ${!r.is_fixed ? 'bg-blue-600 text-white' : 'bg-gray-200 hover:bg-gray-300'}`}
                              disabled={saving}
                            >
                              변동지출
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

/* ============================================================
   ✅ Suspense 래핑 (빌드 오류 방지)
============================================================ */
export default function UnclassifiedPage() {
  return (
    <Suspense fallback={<div className="p-6">로딩 중...</div>}>
      <UnclassifiedInner />
    </Suspense>
  )
}