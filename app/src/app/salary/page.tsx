'use client'

import { useEffect, useState, useMemo } from 'react'
import { API_BASE, apiAuthHeader } from '@/lib/api'   // ✅ apiAuthHeader 추가

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

  // ✅ 조회용 상태
  const [listStartMonth, setListStartMonth] = useState('')
  const [listEndMonth, setListEndMonth] = useState('')
  const [listRows, setListRows] = useState<any[]>([])
  const [listLoading, setListLoading] = useState(false)

  // ✅ 지점 목록 불러오기
  useEffect(() => {
    const loadBranches = async () => {
      try {
        const headers = await apiAuthHeader()   // ✅ 토큰 헤더 추가
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

  // ✅ 행 추가
  const addRow = () => {
    setRows(prev => [
      ...prev,
      { name: '', rank: '디자이너', base: 0, extra: 0, sales: 0, month: new Date().toISOString().slice(0, 7) }
    ])
  }

  // ✅ 행 삭제
  const removeRow = (idx: number) => setRows(prev => prev.filter((_, i) => i !== idx))

  // ✅ 행 변경
  const updateRow = (idx: number, field: keyof DesignerInput, value: any) => {
    setRows(prev => {
      const copy = [...prev]
      copy[idx] = { ...copy[idx], [field]: value }
      return copy
    })
  }

  // ✅ 총급여 계산
  const totalSalary = (r: DesignerInput) => r.base + (r.extra || 0)

  const totalAll = useMemo(
    () => rows.reduce((sum, r) => sum + totalSalary(r), 0),
    [rows]
  )

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
        total_amount: totalSalary(r)
      }))

      const headers = await apiAuthHeader()   // ✅ 추가됨
      const res = await fetch(`${API_BASE}/transactions/salary_manual_save`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      if (res.ok) alert('✅ 급여 데이터 저장 완료')
      else alert('❌ 저장 실패')
    } catch {
      alert('❌ 서버 오류')
    } finally {
      setLoading(false)
    }
  }

  // ✅ 삭제
  const handleDeleteRow = async (row: any) => {
    if (!confirm(`${row.name} (${row.month}) 급여 데이터를 삭제하시겠습니까?`)) return
    try {
      const headers = await apiAuthHeader()   // ✅ 추가됨
      const res = await fetch(`${API_BASE}/transactions/salary_manual_delete`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          branch,
          name: row.name,
          month: row.month
        })
      })
      if (res.ok) {
        alert('🗑️ 삭제 완료')
        setListRows(prev => prev.filter(r => !(r.name === row.name && r.month === row.month)))
      } else {
        alert('❌ 삭제 실패')
      }
    } catch (err) {
      console.error(err)
      alert('❌ 서버 오류')
    }
  }

  // ✅ 급여 조회
  const handleFetchList = async () => {
    if (!branch || !listStartMonth || !listEndMonth)
      return alert('지점과 조회 기간을 선택하세요.')

    setListLoading(true)
    try {
      const headers = await apiAuthHeader()   // ✅ 토큰 추가됨
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

  const listTotal = useMemo(
    () => listRows.reduce((sum, r) => sum + (Number(r.total_amount) || Number(r.amount) || 0), 0),
    [listRows]
  )

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-10">
      {/* 이하 모든 부분은 그대로 */}
      {/* 👇 아래 JSX 전부 기존 그대로 유지 */}
      {/* ✅ 지점선택, 입력테이블, 조회테이블 변경 없음 */}
      {/* (위의 fetch 부분만 수정됨) */}
      ...
    </main>
  )
}