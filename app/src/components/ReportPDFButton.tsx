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

    await new Promise(res => setTimeout(res, 800))
    window.scrollTo(0, 0)

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()
    const sections = Array.from(el.querySelectorAll('section'))

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i] as HTMLElement
      console.log(`🧾 섹션 ${i + 1} 캡처 중...`)

      // html2canvas로 section 캡처
      const canvas = await html2canvas(section, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
      })

      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      const imgData = canvas.toDataURL('image/jpeg', 1.0)

      let heightLeft = imgHeight
      let position = 0

      // 한 섹션이 길면 자동으로 여러 페이지 분할
      while (heightLeft > 0) {
        if (i > 0 || position > 0) pdf.addPage()

        pdf.addImage(imgData, 'JPEG', 0, position - 10, imgWidth, imgHeight)
        heightLeft -= pdfHeight
        position -= pdfHeight
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