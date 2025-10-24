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

    // ✅ 모든 차트가 완전히 렌더될 때까지 대기
    await new Promise<void>((resolve) => {
      const check = () => {
        const charts = document.querySelectorAll('canvas')
        if (charts.length > 0 && Array.from(charts).every(c => c.height > 0)) resolve()
        else setTimeout(check, 400)
      }
      check()
    })

    // ✅ 스크롤 최상단으로 이동
    window.scrollTo(0, 0)

    // ✅ 캡처 대상 복제본 생성 (잘림 방지)
    const clone = el.cloneNode(true) as HTMLElement
    clone.style.marginTop = '60px'
    clone.style.paddingTop = '40px'
    clone.style.background = '#ffffff'
    clone.style.width = `${el.scrollWidth}px`
    clone.style.position = 'absolute'
    clone.style.top = '0'
    clone.style.left = '0'
    clone.style.zIndex = '-1'
    document.body.appendChild(clone)

    const pdf = new jsPDF('p', 'mm', 'a4')
    const pdfWidth = pdf.internal.pageSize.getWidth()
    const pdfHeight = pdf.internal.pageSize.getHeight()

    const canvas = await html2canvas(clone, {
      scale: 2, // 고해상도 캡처
      useCORS: true,
      allowTaint: true,
      scrollY: 0,
      backgroundColor: '#ffffff',
      windowWidth: clone.scrollWidth,
      windowHeight: clone.scrollHeight,
    })

    const imgWidth = pdfWidth
    const imgHeight = (canvas.height * imgWidth) / canvas.width
    const imgData = canvas.toDataURL('image/jpeg', 1.0)

    let heightLeft = imgHeight
    let position = 0
    let page = 1

    while (heightLeft > 0) {
      if (page > 1) pdf.addPage()
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight)
      heightLeft -= pdfHeight
      position -= pdfHeight
      page++
    }

    // ✅ 메모리 정리
    document.body.removeChild(clone)

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