import { useState } from 'react'
import { ContinueRail } from './ContinueRail'
import { SectionTree } from './SectionTree'
import { RecentCards } from './RecentCards'
import { SearchSheet } from './SearchSheet'

export function Library() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>Library</h1>
        <button aria-label="Search" onClick={() => setSearchOpen(true)} style={{ width: 44, height: 44, fontSize: 20, border: 0, background: 'transparent' }}>🔍</button>
      </div>
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Continue</div>
      <ContinueRail />
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Sections</div>
      <SectionTree />
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Recent cards</div>
      <RecentCards />
      <SearchSheet open={searchOpen} onDismiss={() => setSearchOpen(false)} />
    </div>
  )
}
