'use client'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const router = useRouter()

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')

    // 1️⃣ Supabase 로그인
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setErr(error.message)
      return
    }

    // 2️⃣ 토큰 가져오기
    const token = data.session?.access_token
    if (!token) {
      setErr('인증 토큰을 가져올 수 없습니다.')
      return
    }

    try {
      // 3️⃣ /me API에서 role 확인
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setErr('사용자 정보를 불러올 수 없습니다.')
        return
      }

      const userInfo = await res.json()
      const role = userInfo.role || 'viewer'

      console.log('✅ 로그인 성공:', { email, role })

      // 4️⃣ role 기반으로 라우팅
      if (role === 'admin') {
        router.push('/dashboard')
      } else {
        router.push('/dashboard/viewer')
      }

    } catch (err) {
      console.error('❌ 로그인 후 역할 확인 실패:', err)
      setErr('로그인 처리 중 오류가 발생했습니다.')
    }
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="text-2xl font-semibold mb-4">로그인</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          className="input"
          placeholder="이메일"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {err && <div className="text-red-600 text-sm">{err}</div>}
        <button type="submit" className="btn w-full">로그인</button>
      </form>
    </div>
  )
}