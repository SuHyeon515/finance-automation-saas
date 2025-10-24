'use client'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useState } from 'react'

type Category = {
  id: string
  type: '고정지출' | '변동지출' | '수입' | '유동자산' | '부동자산'
  name: string
}

export default function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([])
  const [type, setType] = useState<'고정지출' | '변동지출' | '수입' | '유동자산' | '부동자산'>('고정지출')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  // ✅ 불러오기
  const load = async () => {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) return
    const { data, error } = await supabase
      .from('categories')
      .select('id, type, name')
      .eq('user_id', userId)
      .order('type')
    if (error) setErr(error.message)
    setCategories(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // ✅ 추가
  const add = async () => {
    setErr('')
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) { setErr('로그인이 필요합니다'); return }

    if (!name.trim()) return alert('카테고리 이름을 입력하세요.')

    const exists = categories.some(c => c.type === type && c.name === name.trim())
    if (exists) return alert('이미 존재하는 카테고리입니다.')

    const { error } = await supabase
      .from('categories')
      .insert([{ user_id: userId, type, name: name.trim() }])

    if (error) setErr(error.message)
    else { setName(''); load() }
  }

  // ✅ 삭제
  const remove = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    await supabase.from('categories').delete().eq('id', id)
    load()
  }

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">📂 카테고리 관리</h1>

      {/* 추가 섹션 */}
      <section className="card space-y-3">
        <h2 className="font-semibold">새 카테고리 추가</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <select
            className="border rounded px-2 py-1"
            value={type}
            onChange={e => setType(e.target.value as any)}
          >
            <option value="고정지출">고정지출</option>
            <option value="변동지출">변동지출</option>
            <option value="수입">수입</option>
            <option value="유동자산">유동자산</option>
            <option value="부동자산">부동자산</option>
          </select>
          <input
            className="border rounded px-2 py-1 w-48"
            placeholder="카테고리 이름"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <button className="bg-blue-600 text-white px-3 py-1 rounded" onClick={add}>
            추가
          </button>
        </div>
        {err && <p className="text-red-600 text-sm">{err}</p>}
      </section>

      {/* 목록 섹션 */}
      {loading ? (
        <p>불러오는 중...</p>
      ) : (
        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {['고정지출', '변동지출', '수입', '유동자산', '부동자산'].map(t => (
            <div key={t} className="border rounded-lg p-4 bg-white shadow-sm">
              <h3 className="font-semibold text-lg mb-2">{t}</h3>
              <div className="space-y-1">
                {categories.filter(c => c.type === t).map(c => (
                  <div key={c.id} className="flex items-center justify-between border-b py-1">
                    <span>{c.name}</span>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => remove(c.id)}
                    >
                      삭제
                    </button>
                  </div>
                ))}
                {categories.filter(c => c.type === t).length === 0 && (
                  <p className="text-gray-400 text-sm">카테고리 없음</p>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  )
}