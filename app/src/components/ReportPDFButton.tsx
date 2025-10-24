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

    console.log('📸 렌더링 캡처 준비중...')

    // ✅ 렌더링 안정화 대기
    await new Promise(res => setTimeout(res, 1200))
    window.scrollTo(0, 0)

    // ✅ html2canvas로 전체 페이지 캡처
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: el.scrollWidth,
      windowHeight: el.scrollHeight,
    })

    console.log('✅ 캡처 완료, PDF 변환 중...')

    // ✅ PDF 세팅
    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    // ✅ 이미지 비율 맞추기
    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * pdfWidth) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 1.0)

    let yOffset = 0
    const onePageHeight = (pdfWidth / canvas.width) * pdfHeight * (canvas.width / pdfWidth)

    // ✅ 여러 페이지 자동 분할
    while (yOffset < canvas.height) {
      const pageCanvas = document.createElement('canvas')
      pageCanvas.width = canvas.width
      pageCanvas.height = Math.min(onePageHeight * 2, canvas.height - yOffset)
      const ctx = pageCanvas.getContext('2d')!
      ctx.drawImage(canvas, 0, yOffset, canvas.width, pageCanvas.height, 0, 0, canvas.width, pageCanvas.height)

      const pageImg = pageCanvas.toDataURL('image/jpeg', 1.0)
      const pageHeightMM = (pageCanvas.height * pdfWidth) / pageCanvas.width

      pdf.addImage(pageImg, 'JPEG', 0, 0, pdfWidth, pageHeightMM)
      yOffset += pageCanvas.height

      if (yOffset < canvas.height) pdf.addPage()
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