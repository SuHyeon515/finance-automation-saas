'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export default function NavBar() {
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<'admin' | 'viewer'>('viewer')
  const [loading, setLoading] = useState(true)

  // ✅ 공통 유저 정보 불러오기
  const fetchUserInfo = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError || !user) {
        setUserEmail(null)
        setUserRole('viewer')
        setLoading(false)
        return
      }

      setUserEmail(user.email || null)

      // JWT 토큰 가져오기
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      if (!token) {
        console.warn('❌ 토큰 없음 (로그인 세션 없음)')
        setUserRole('viewer')
        setLoading(false)
        return
      }

      // FastAPI /me 호출 → role 받기
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        console.warn('⚠️ /me 응답 실패:', res.status)
        setUserRole('viewer')
      } else {
        const data = await res.json()
        setUserRole(data.role === 'admin' ? 'admin' : 'viewer')
      }
    } catch (err) {
      console.error('⚠️ fetchUserInfo 실패:', err)
      setUserRole('viewer')
    } finally {
      setLoading(false)
    }
  }

  // ✅ 1회 실행 + 로그인 상태 변화 구독
  useEffect(() => {
    fetchUserInfo()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) fetchUserInfo()
      else {
        setUserEmail(null)
        setUserRole('viewer')
      }
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  // ✅ 로그아웃 시 새로고침 포함
  const logout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  // ✅ 메뉴 구성
  const adminMenu = [
    { href: '/dashboard', title: '대시보드' },
    { href: '/upload', title: '업로드' },
    { href: '/reports', title: '리포트' },
    { href: '/assets', title: '자산 관리' },
    { href: '/analysis', title: 'GPT 분석' },
  ]

  const viewerMenu = [
    { href: '/dashboard/viewer', title: '대시보드' },
    { href: '/reports', title: '리포트' },
    { href: '/analyses', title: 'GPT 분석 저장' },
  ]

  const menu = userRole === 'admin' ? adminMenu : viewerMenu

  return (
    <nav className="bg-white border-b">
      <div className="container flex items-center justify-between h-14">
        {/* 왼쪽 */}
        <div className="font-semibold">
          💼 재무 자동화{' '}
          {userRole === 'viewer' && (
            <span className="text-sm text-blue-500">(보기 전용)</span>
          )}
        </div>

        {/* 가운데 메뉴 */}
        <div className="flex gap-4">
          {menu.map((item) => (
            <Link key={item.href} className="link" href={item.href}>
              {item.title}
            </Link>
          ))}
        </div>

        {/* 오른쪽 */}
        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-sm text-gray-400">로딩 중...</span>
          ) : userEmail ? (
            <span className="text-sm text-gray-600">
              {userEmail}{' '}
              <span
                className={`font-semibold ${
                  userRole === 'admin' ? 'text-red-600' : 'text-blue-600'
                }`}
              >
                ({userRole})
              </span>
            </span>
          ) : (
            <span className="text-sm text-gray-400">로그인 안됨</span>
          )}

          <button onClick={logout} className="btn">로그아웃</button>
        </div>
      </div>
    </nav>
  )
}