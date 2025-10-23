'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

export default function UploadPage() {
  const [branches, setBranches] = useState<string[]>([])
  const [branch, setBranch] = useState('')
  const [customBranch, setCustomBranch] = useState('')
  const [branchError, setBranchError] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // ✅ 인증된 사용자 토큰을 이용해 branches 불러오기
  useEffect(() => {
    api.branches()
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [])

  // ✅ 중복 검사
  useEffect(() => {
    if (!customBranch.trim()) {
      setBranchError('')
      return
    }
    const exists = branches.some(
      b => b.trim() === customBranch.trim()
    )
    setBranchError(exists ? '이미 존재하는 지점입니다.' : '')
  }, [customBranch, branches])

  // ✅ 업로드 처리
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return alert('엑셀 파일을 선택하세요!')

    const selectedBranch = branch || customBranch.trim()
    if (!selectedBranch) return alert('지점을 선택하거나 직접 입력하세요!')
    if (branchError) return alert(branchError)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('branch', selectedBranch)
    formData.append('period_year', String(year))
    formData.append('period_month', String(month))

    setLoading(true)
    setMessage('업로드 중...')

    try {
      const token = await (await import('@/lib/api')).apiAuthHeader()
      const res = await fetch(`${api.API_BASE}/upload`, {
        method: 'POST',
        body: formData,
        headers: token,
      })

      if (!res.ok) throw new Error(await res.text())

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename =
        match?.[1] ||
        `processed_${year}-${String(month).padStart(2, '0')}_${selectedBranch}.xlsx`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)

      setMessage('✅ 업로드 및 처리 완료! 결과 파일이 다운로드되었습니다.')
    } catch (err: any) {
      setMessage(`❌ 업로드 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="max-w-xl mx-auto p-6 space-y-5">
      <h1 className="text-2xl font-semibold mb-4">📂 거래내역 파일 업로드</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* ✅ 지점 선택 */}
        <div>
          <label className="block text-sm mb-1">지점 선택</label>
          <select
            value={branch}
            onChange={e => {
              setBranch(e.target.value)
              setCustomBranch('')
              setBranchError('')
            }}
            className="border rounded px-3 py-2 w-full mb-2"
          >
            <option value="">-- 지점 선택 --</option>
            {branches.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="지점명을 직접 입력하세요 (선택 대신)"
            value={customBranch}
            onChange={e => {
              setCustomBranch(e.target.value)
              setBranch('')
            }}
            className={`border rounded px-3 py-2 w-full text-sm text-gray-700 ${
              branchError ? 'border-red-400' : ''
            }`}
          />

          {branchError && (
            <p className="text-red-500 text-xs mt-1">{branchError}</p>
          )}
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm mb-1">연도</label>
            <input
              type="number"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm mb-1">월</label>
            <input
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="border rounded px-3 py-2 w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm mb-1">엑셀 파일 선택</label>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="border rounded px-3 py-2 w-full"
          />
        </div>

        <button
          disabled={loading}
          className="w-full bg-black text-white rounded py-2 hover:opacity-90"
        >
          {loading ? '업로드 중...' : '업로드 및 처리'}
        </button>
      </form>

      {message && <p className="text-center text-sm mt-2">{message}</p>}

      <div className="text-center mt-6">
        <a href="/uploads" className="text-blue-600 hover:underline">
          📋 업로드 내역 보기 →
        </a>
      </div>
    </main>
  )
}