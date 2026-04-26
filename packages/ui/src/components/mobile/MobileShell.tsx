import { useMobileNav } from '../../store/mobileNav'
import { BottomTabBar } from './BottomTabBar'
import { SafeArea } from './shared/SafeArea'
import { QuickCapture } from './capture/QuickCapture'
import { Library } from './library/Library'
import { YouSurface } from './you/YouSurface'

export interface MobileShellProps {
  signOut: () => Promise<void>
}

export function MobileShell({ signOut }: MobileShellProps) {
  const tab = useMobileNav((s) => s.tab)
  return (
    <div data-mobile-shell style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SafeArea edges={['top']}>
        <header style={{ padding: '8px 16px', fontSize: 14, color: '#666' }}>1Scratch</header>
      </SafeArea>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'capture' && <QuickCapture />}
        {tab === 'canvas'  && <h1 style={{ padding: 16 }}>Canvas (PR 5)</h1>}
        {tab === 'library' && <Library />}
        {tab === 'you'     && <YouSurface signOut={signOut} />}
      </main>
      <BottomTabBar />
    </div>
  )
}
