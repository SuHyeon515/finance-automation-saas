'use client'

import { useEffect, useState } from 'react'
import { API_BASE } from '@/lib/api'
import { supabase } from '@/lib/supabaseClient'

type UploadItem = {
  id: string
  original_filename: string
  branch: string
  period_year: number
  period_month: number
  total_rows: number
  unclassified_rows: number
  created_at: string
}

export default function UploadsPage() {
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [branches, setBranches] = useState<string[]>([]) // ✅ 지점 목록
  const [selectedBranch, setSelectedBranch] = useState<string>('') // ✅ 선택된 지점
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // --- Supabase 세션 토큰 가져오기
  useEffect(() => {
    const getToken = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) {
        setAccessToken(session.access_token)
      } else {
        console.warn('❌ No Supabase session found')
      }
    }
    getToken()
  }, [])

  // --- 📦 지점 목록 불러오기
  const fetchBranches = async () => {
    if (!accessToken) return
    try {
      const res = await fetch(`${API_BASE}/meta/branches`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json()
      setBranches(data || [])
    } catch (err) {
      console.error('⚠️ 지점 목록 불러오기 실패:', err)
    }
  }

  // --- 📁 업로드 목록 불러오기
  const fetchUploads = async (branchParam?: string) => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const url = new URL(`${API_BASE}/uploads`)
      if (branchParam) url.searchParams.append('branch', branchParam)

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const data = await res.json()
      setUploads(data.items || [])
    } catch (err: any) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // --- 삭제
  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까? 이 업로드의 거래 데이터도 함께 삭제됩니다.')) return
    try {
      await fetch(`${API_BASE}/uploads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      fetchUploads(selectedBranch)
    } catch (err) {
      alert('삭제 중 오류가 발생했습니다.')
    }
  }

  // --- 토큰 생기면 데이터 불러오기
  useEffect(() => {
    if (accessToken) {
      fetchBranches()
      fetchUploads()
    }
  }, [accessToken])

  // --- 지점 선택 변경 시 업로드 새로 불러오기
  useEffect(() => {
    if (accessToken) fetchUploads(selectedBranch)
  }, [selectedBranch])

  return (
    <main className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">🧾 업로드 내역</h1>

      {/* ✅ 지점 선택 드롭다운 */}
      <div className="mb-4 flex items-center gap-2">
        <label className="font-medium">지점 선택:</label>
        <select
          value={selectedBranch}
          onChange={(e) => setSelectedBranch(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="">전체보기</option>
          {branches.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      {loading && <p>불러오는 중...</p>}
      {error && <p className="text-red-500">{error}</p>}

      <div className="space-y-4">
        {uploads.map((u) => (
          <div
            key={u.id}
            className="border rounded-lg p-4 flex justify-between items-center bg-white shadow-sm hover:shadow-md transition"
          >
            <div>
              <div className="font-semibold">{u.original_filename}</div>
              <div className="text-sm text-gray-600">
                {u.period_year}-{String(u.period_month).padStart(2, '0')} · {u.branch}
              </div>
              <div className="text-sm mt-1">
                총 {u.total_rows.toLocaleString()}행 중{' '}
                <span className="text-red-500">
                  미분류 {u.unclassified_rows.toLocaleString()}건
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                업로드일 {new Date(u.created_at).toLocaleString('ko-KR')}
              </div>
            </div>

            <div className="flex gap-3">
              <a
                href={`/unclassified?branch=${encodeURIComponent(u.branch)}&year=${u.period_year}&month=${u.period_month}`}
                className="px-3 py-2 border rounded hover:bg-gray-50"
              >
                미분류 관리
              </a>
              <button
                onClick={() => handleDelete(u.id)}
                className="px-3 py-2 border border-red-500 text-red-600 rounded hover:bg-red-50"
              >
                삭제
              </button>
            </div>
          </div>
        ))}

        {!loading && uploads.length === 0 && (
          <p className="text-gray-500">업로드된 데이터가 없습니다.</p>
        )}
      </div>
    </main>
  )
}