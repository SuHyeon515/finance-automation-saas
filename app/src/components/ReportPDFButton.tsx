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
      alert('리포트 내용을 찾을 수 없습니다.')
      return
    }

    console.log('📸 렌더링 캡처 시작')

    // ✅ 렌더 안정화 (Recharts 등 캔버스 완성 대기)
    await new Promise(res => setTimeout(res, 1200))
    window.scrollTo(0, 0)

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    try {
      // ✅ html2canvas 고급 옵션
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        allowTaint: true,
        foreignObjectRendering: true,
        logging: false,
        scrollX: 0,
        scrollY: 0,
        windowWidth: document.documentElement.scrollWidth,
        windowHeight: document.documentElement.scrollHeight,
      })

      console.log('✅ 캡처 완료, PDF 변환 중...')

      const imgData = canvas.toDataURL('image/jpeg', 1.0)
      const imgWidth = pdfWidth
      const imgHeight = (canvas.height * pdfWidth) / canvas.width

      let heightLeft = imgHeight
      let position = 0

      while (heightLeft > 0) {
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
        heightLeft -= pdfHeight
        if (heightLeft > 0) {
          pdf.addPage()
          position -= pdfHeight
        }
      }

      pdf.save(`${title}.pdf`)
      console.log('✅ PDF 저장 완료')
    } catch (err) {
      console.error('❌ PDF 생성 오류:', err)
      alert('PDF 생성 중 오류가 발생했습니다. 콘솔을 확인하세요.')
    }
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