'use client'

import Guard from '@/components/Guard'
import Link from 'next/link'

const cards = [
//   { href: '/upload',        title: '📂 파일 업로드',     desc: '엑셀 업로드 → 자동 분류 → 처리 엑셀 다운로드' },
//   { href: '/uploads',       title: '🧾 업로드 내역',      desc: '업로드 이력 조회 / 처리파일 다운로드 / 삭제' },
//   { href: '/rules',         title: '🏷️ 카테고리 관리',    desc: '수입/지출/자산 카테고리 관리' },
//   { href: '/assets',        title: '💰 자산 관리',        desc: '부동 자산과 유동 자산 관리' },
//   { href: '/salary',        title: '💵 매장데이터 관리',  desc: '매장 디자이너 및 인턴 수 / 방문객 데이터 관리' },
  { href: '/reports',       title: '📊 리포트',           desc: '월/주/일/연 · 지점/카테고리별 집계' },
//   { href: '/analysis',      title: '🤖 GPT 분석',         desc: '실현매출 중심 경영 인사이트 자동 생성' },
  { href: '/analyses',      title: '🧠 GPT 분석 저장',    desc: 'GPT 기반 리포트 저장 및 조회' },
//   { href: '/users',         title: '🔐 사용자/권한 관리', desc: '계정별 권한 관리 및 열람 전용 계정' }, // 👈 나중에 주석처리 가능
//   { href: '/settings',      title: '⚙️ 시스템 설정',      desc: '환경설정, 알림 설정 등 시스템 관련 관리' }, // 👈 나중에 주석처리 가능
]

export default function ViewerDashboard() {
  return (
    <Guard>
      <div className="p-8">
        <h1 className="text-2xl font-semibold mb-4">👀 Viewer Dashboard</h1>
        <p className="text-gray-600 mb-8">
          이 계정은 <strong>보기 전용(Viewer)</strong> 권한으로, 데이터 확인은 가능하지만 수정/삭제/업로드는 제한됩니다.
        </p>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="border rounded-2xl p-4 hover:shadow-md transition bg-white"
            >
              <div className="text-xl font-semibold mb-1">{c.title}</div>
              <div className="text-gray-600">{c.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </Guard>
  )
}