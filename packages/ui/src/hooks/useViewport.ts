import { useEffect, useState } from 'react'

export interface Viewport {
  width: number
  height: number
  safeAreaTop: number
  safeAreaBottom: number
  safeAreaLeft: number
  safeAreaRight: number
  isMobile: boolean
}

const SSR: Viewport = {
  width: 0, height: 0,
  safeAreaTop: 0, safeAreaBottom: 0, safeAreaLeft: 0, safeAreaRight: 0,
  isMobile: false,
}

function readSafeArea(): { top: number; bottom: number; left: number; right: number } {
  if (typeof document === 'undefined') return { top: 0, bottom: 0, left: 0, right: 0 }
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
    'env(safe-area-inset-bottom) env(safe-area-inset-left);'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = {
    top:    parseFloat(cs.paddingTop)    || 0,
    right:  parseFloat(cs.paddingRight)  || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left:   parseFloat(cs.paddingLeft)   || 0,
  }
  probe.remove()
  return out
}

function readViewport(): Viewport {
  if (typeof window === 'undefined') return SSR
  const vv = window.visualViewport
  const width  = vv?.width  ?? window.innerWidth
  const height = vv?.height ?? window.innerHeight
  const sa = readSafeArea()
  return {
    width, height,
    safeAreaTop: sa.top,
    safeAreaBottom: sa.bottom,
    safeAreaLeft: sa.left,
    safeAreaRight: sa.right,
    isMobile: width < 600,
  }
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => readViewport())
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setVp(readViewport()))
    }
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])
  return vp
}
