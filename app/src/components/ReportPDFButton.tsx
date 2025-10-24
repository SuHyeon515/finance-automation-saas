'use client'

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { useCallback } from 'react'

interface Props {
  elementId: string
  title: string
}

export default function ReportPDFButton({ elementId, title }: Props) {
  const handleDownloadPDF = useCallback(async () => {
    const el = document.getElementById(elementId)
    if (!el) {
      alert('리포트를 찾을 수 없습니다.')
      return
    }

    console.log('📸 긴 리포트 PDF 생성 시작')

    // ✅ 모든 캔버스 / 차트가 렌더 완료될 때까지 대기
    await new Promise<void>((resolve) => {
      const check = () => {
        const charts = document.querySelectorAll('canvas')
        if (charts.length > 0 && Array.from(charts).every(c => c.height > 0 && c.width > 0))
          resolve()
        else setTimeout(check, 400)
      }
      check()
    })

    window.scrollTo(0, 0)
    await new Promise(res => setTimeout(res, 600)) // 안정화 대기

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    const sections = Array.from(el.querySelectorAll('section'))
    console.log(`📄 캡처 대상 섹션 수: ${sections.length}`)

    let page = 0
    for (const [i, section] of sections.entries()) {
      console.log(`🧾 섹션 ${i + 1} 캡처 중...`)
      const canvas = await html2canvas(section as HTMLElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
      })

      const imgData = canvas.toDataURL('image/jpeg', 1.0)
      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width

      let heightLeft = imgHeight
      let position = 0

      // ✅ 한 섹션이 페이지를 넘어가면 나눠서 추가
      while (heightLeft > 0) {
        if (page > 0 || position > 0) pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
        heightLeft -= pdfHeight
        position -= pdfHeight
        page++
      }
    }

    pdf.save(`${title}.pdf`)
    console.log('✅ PDF 저장 완료')
  }, [elementId, title])

  return (
    <button
      onClick={handleDownloadPDF}
      className="bg-red-600 text-white rounded px-4 py-2 hover:opacity-80"
    >
      📄 PDF로 저장
    </button>
  )
}