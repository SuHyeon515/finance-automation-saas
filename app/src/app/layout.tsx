import './globals.css'
import NavBar from '@/components/NavBar'

export const metadata = { title: '재무 자동화', description: '가계부 자동 분류 & GPT 분석' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <NavBar />
        <main className="container py-6">{children}</main>
      </body>
    </html>
  )
}
