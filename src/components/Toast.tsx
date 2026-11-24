import { useEffect, useState } from 'react'

export type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

const listeners = new Set<(item: ToastItem) => void>()
let nextId = 1

export function showToast(type: ToastType, message: string) {
  const item: ToastItem = { id: nextId++, type, message }
  listeners.forEach((listener) => listener(item))
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    const onToast = (item: ToastItem) => {
      setItems((current) => [...current.slice(-2), item])
      window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id))
      }, 3200)
    }
    listeners.add(onToast)
    return () => {
      listeners.delete(onToast)
    }
  }, [])

  if (!items.length) return null

  return (
    <div className="fig-toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`fig-toast fig-toast-${item.type}`} role="status">
          <span className="fig-toast-dot" aria-hidden="true" />
          <span>{item.message}</span>
        </div>
      ))}
    </div>
  )
}
