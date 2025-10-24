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

    // ✅ 화면 맨 위로 스크롤
    window.scrollTo(0, 0)
    await new Promise(res => setTimeout(res, 1000)) // 렌더링 대기

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    // ✅ 캔버스 생성 (정확히 렌더된 이미지)
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.scrollWidth,
      windowHeight: document.documentElement.scrollHeight,
    })

    const imgData = canvas.toDataURL('image/jpeg', 1.0)
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width

    // ✅ 페이지 분할 (높이가 A4를 초과하면 자동 추가)
    let position = 0
    let remainingHeight = imgHeight

    while (remainingHeight > 0) {
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      remainingHeight -= pdfHeight
      if (remainingHeight > 0) {
        pdf.addPage()
        position = -remainingHeight + 10
      }
    }

    pdf.save(`${title}.pdf`)
    console.log('✅ PDF 저장 완료 (수동 캡처)')
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