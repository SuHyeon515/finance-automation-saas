// @ts-nocheck
'use client'
import Guard from '@/components/Guard'
import AdminGuard from '@/components/AdminGuard'
import { api, apiAuthHeader } from '@/lib/api'
import { useEffect, useState } from 'react'

type Tx = {
  id:string, tx_date:string, branch:string, description:string, memo:string,
  amount:number, category?:string, category_l1?:string, category_l2?:string, category_l3?:string, is_fixed?:boolean
}

export default function DataPage() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()+1)
  const [branch, setBranch] = useState('')
  const [items, setItems] = useState<Tx[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [err, setErr] = useState('')

  const load = async () => {
    const headers = await apiAuthHeader()
    const res = await api.get('/transactions', { params: { year, month, branch: branch || undefined }, headers })
    setItems(res.data.items || [])
    setChecked({})
  }

  const toggle = (id:string) => setChecked(p => ({...p, [id]: !p[id]}))
  const allToggle = (val:boolean) => {
    const obj:Record<string, boolean> = {}
    items.forEach(i => { obj[i.id] = val })
    setChecked(obj)
  }

  const del = async () => {
    const ids = Object.keys(checked).filter(k => checked[k])
    if (!ids.length) return
    const headers = await apiAuthHeader()
    await api.post('/transactions/delete', { ids }, { headers })
    await load()
  }

  useEffect(() => { load() }, [])

  return (
    <Guard>
      <AdminGuard>
        <div className="card">
          <h1 className="text-xl font-semibold">데이터 관리 (삭제)</h1>
          <div className="grid md:grid-cols-4 gap-2 mt-3">
            <input className="input" type="number" value={year} onChange={e=>setYear(Number(e.target.value))} />
            <input className="input" type="number" value={month} onChange={e=>setMonth(Number(e.target.value))} />
            <input className="input" placeholder="지점(전체 비우기)" value={branch} onChange={e=>setBranch(e.target.value)} />
            <button className="btn" onClick={load}>조회</button>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" onChange={e=>allToggle(e.target.checked)} />
              전체 선택/해제
            </label>
            <button className="btn" onClick={del}>선택 삭제</button>
          </div>
          <div className="mt-3 space-y-2">
            {items.map(tx => (
              <div key={tx.id} className="grid grid-cols-12 items-center border rounded-lg p-2 text-sm">
                <div className="col-span-1">
                  <input type="checkbox" checked={!!checked[tx.id]} onChange={()=>toggle(tx.id)} />
                </div>
                <div className="col-span-2">{tx.tx_date}</div>
                <div className="col-span-2">{tx.branch}</div>
                <div className="col-span-3 truncate">{tx.description}</div>
                <div className="col-span-2 text-right">{tx.amount.toLocaleString()}</div>
                <div className="col-span-2 truncate">{tx.category_l3 || tx.category || ''}</div>
              </div>
            ))}
          </div>
          {err && <div className="text-red-600 text-sm mt-2">{err}</div>}
        </div>
      </AdminGuard>
    </Guard>
  )
}
