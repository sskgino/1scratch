import type { ReactNode } from 'react'
import { useViewport } from '../../../hooks/useViewport'

type Edge = 'top' | 'bottom' | 'left' | 'right'

export interface SafeAreaProps {
  children: ReactNode
  edges?: Edge[]
  style?: React.CSSProperties
}

const ALL: Edge[] = ['top', 'bottom', 'left', 'right']

export function SafeArea({ children, edges = ALL, style }: SafeAreaProps) {
  const vp = useViewport()
  const padding = {
    paddingTop:    edges.includes('top')    ? vp.safeAreaTop    : 0,
    paddingBottom: edges.includes('bottom') ? vp.safeAreaBottom : 0,
    paddingLeft:   edges.includes('left')   ? vp.safeAreaLeft   : 0,
    paddingRight:  edges.includes('right')  ? vp.safeAreaRight  : 0,
  }
  return <div style={{ ...padding, ...style }}>{children}</div>
}
