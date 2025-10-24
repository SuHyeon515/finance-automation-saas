'use client'

import { useCallback } from 'react'
import html2pdf from 'html2pdf.js'

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

    const opt = {
      margin: 10,
      filename: `${title}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'p' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'table', 'section'] },
    }

    try {
      // @ts-ignore
      await html2pdf().from(el).set(opt).save()
      console.log('✅ PDF 저장 완료')
    } catch (err) {
      console.error('❌ PDF 생성 실패:', err)
      alert('PDF 생성 중 오류 발생')
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