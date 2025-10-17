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

  const fetchUploads = async () => {
    if (!accessToken) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/uploads`, {
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

  const handleDelete = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까? 이 업로드의 거래 데이터도 함께 삭제됩니다.')) return
    try {
      await fetch(`${API_BASE}/uploads/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      fetchUploads()
    } catch (err) {
      alert('삭제 중 오류가 발생했습니다.')
    }
  }

  useEffect(() => {
    if (accessToken) fetchUploads()
  }, [accessToken])

  return (
    <main className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">🧾 업로드 내역</h1>

      {loading && <p>불러오는 중...</p>}
      {error && <p className="text-red-500">{error}</p>}

      <div className="space-y-4">
        {uploads.map(u => (
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
