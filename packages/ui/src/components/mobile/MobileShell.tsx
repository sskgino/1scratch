import { useMobileNav } from '../../store/mobileNav'
import { BottomTabBar } from './BottomTabBar'
import { SafeArea } from './shared/SafeArea'

export function MobileShell() {
  const tab = useMobileNav((s) => s.tab)
  return (
    <div data-mobile-shell style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SafeArea edges={['top']}>
        <header style={{ padding: '8px 16px', fontSize: 14, color: '#666' }}>1Scratch</header>
      </SafeArea>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'capture' && <h1 style={{ padding: 16 }}>Capture</h1>}
        {tab === 'canvas'  && <h1 style={{ padding: 16 }}>Canvas</h1>}
        {tab === 'library' && <h1 style={{ padding: 16 }}>Library</h1>}
        {tab === 'you'     && <h1 style={{ padding: 16 }}>You</h1>}
      </main>
      <BottomTabBar />
    </div>
  )
}
