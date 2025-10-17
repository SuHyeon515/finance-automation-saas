'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'

export default function Guard({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(false)
  const router = useRouter()
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session) router.replace('/')
      else setOk(true)
    })()
  }, [router])
  if (!ok) return null
  return <>{children}</>
}
