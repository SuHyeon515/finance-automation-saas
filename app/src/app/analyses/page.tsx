'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { API_BASE, apiAuthHeader } from '@/lib/api' // ✅ 토큰 자동 주입 추가

type Analysis = {
  id: string
  branch: string
  title: string
  created_at: string
}

export default function AnalysesPage() {
  const [items, setItems] = useState<Analysis[]>([])
  const [loading, setLoading] = useState(false)

  // ✅ 데이터 불러오기
  const loadItems = async () => {
    setLoading(true)
    try {
      const headers = await apiAuthHeader() // ✅ 토큰 포함
      const res = await fetch(`${API_BASE}/analyses`, {
        headers,
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setItems(d.items || [])
    } catch (err) {
      console.error('❌ load error:', err)
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  // ✅ 삭제 함수
  const handleDelete = async (id: string) => {
    if (!confirm('이 분석 리포트를 삭제하시겠습니까?')) return

    try {
      const headers = await apiAuthHeader() // ✅ 토큰 포함
      const res = await fetch(`${API_BASE}/analyses/${id}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`삭제 실패: ${err.detail || res.statusText}`)
        return
      }

      alert('삭제 완료되었습니다.')
      setItems(prev => prev.filter(i => i.id !== id)) // ✅ 즉시 화면에서 제거
    } catch (e) {
      console.error('❌ 삭제 중 오류:', e)
      alert('삭제 중 오류가 발생했습니다.')
    }
  }

  return (
    <main className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">📘 저장된 분석 리포트</h1>

      {loading && <p className="text-gray-500">불러오는 중...</p>}

      {!loading && items.length === 0 && (
        <div className="text-center text-gray-500 border rounded-lg py-10">
          저장된 분석이 없습니다.
        </div>
      )}

      <div className="space-y-3">
        {items.map(a => (
          <div
            key={a.id}
            className="border rounded-lg p-4 flex justify-between items-center hover:bg-gray-50 transition"
          >
            <div>
              <Link href={`/analyses/${a.id}`}>
                <div className="font-semibold text-lg">{a.title}</div>
                <div className="text-gray-500 text-sm">
                  {a.branch} · {new Date(a.created_at).toLocaleString('ko-KR')}
                </div>
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/analyses/${a.id}`}
                className="text-blue-600 font-medium hover:underline"
              >
                보기
              </Link>
              <button
                onClick={() => handleDelete(a.id)}
                className="text-red-500 text-sm hover:underline"
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}