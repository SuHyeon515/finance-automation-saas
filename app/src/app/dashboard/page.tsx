'use client'
import Guard from '@/components/Guard'
import Link from 'next/link'

const cards = [
  { href: '/upload',        title: '📂 파일 업로드',     desc: '엑셀 업로드 → 자동 분류 → 처리 엑셀 다운로드' },
  { href: '/uploads',       title: '🧾 업로드 내역',      desc: '업로드 이력 조회 / 처리파일 다운로드 / 삭제' },
  { href: '/rules',    title: '🏷️ 카테고리 관리',    desc: '수입/지출/자산 카테고리 관리' },
  { href: '/assets',        title: '💰 자산 관리',      desc: '부동 자산과 유동 자산 관리' },
  { href: '/salary', title: '💵 매장데이터 관리', desc: '매장 디자이너 및 인턴 수 방문객 데이터' },
  { href: '/salon',      title: '💇‍♀️ 매출데이터 관리',        desc: '데이터 관리' },
  { href: '/reports',       title: '📊 리포트',          desc: '월/주/일/연 · 지점/카테고리별 집계' },
  { href: '/analysis',      title: '🤖 GPT 분석',        desc: '실현매출 중심 경영 인사이트 자동 생성' },
  { href: '/analyses',      title: '🤖 GPT 분석 저장',        desc: '실현매출 중심 경영 인사이트 자동 저장' },
  // 옵션 메뉴 (원하면 노출)
  // { href: '/users',         title: '🔐 사용자/권한',       desc: '열람 전용 계정 및 역할' },
]

export default function Dashboard() {
  return (
    <Guard>
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
    </Guard>
  )
}
