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

  // 렌더링
  return (
    <main className="p-6 space-y-10 bg-gray-100 min-h-screen">
      {/* === 나머지 UI는 그대로 === */}
      {/* === 기존 렌더링 부분 생략 (변경 없음) === */}
      {/* === 전체 그대로 복사해서 사용하세요 === */}
    </main>
  )
}