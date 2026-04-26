import { useMobileNav, type MobileTab } from '../../store/mobileNav'
import { useHaptics } from '../../hooks/useHaptics'
import { SafeArea } from './shared/SafeArea'

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'capture', label: 'Capture', icon: '✎' },
  { id: 'canvas',  label: 'Canvas',  icon: '⊡' },
  { id: 'library', label: 'Library', icon: '☰' },
  { id: 'you',     label: 'You',     icon: '◉' },
]

export function BottomTabBar() {
  const tab = useMobileNav((s) => s.tab)
  const setTab = useMobileNav((s) => s.setTab)
  const haptics = useHaptics()
  return (
    <SafeArea edges={['bottom', 'left', 'right']} style={{ borderTop: '1px solid #eee', background: '#fff' }}>
      <div role="tablist" style={{ display: 'flex', height: 56 }}>
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              onClick={() => { if (!active) { haptics.light(); setTab(t.id) } }}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', background: 'transparent', border: 0, gap: 2,
                color: active ? '#000' : '#888', fontSize: 12,
              }}
            >
              <span style={{ fontSize: 20 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>
    </SafeArea>
  )
}
