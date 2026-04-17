import { useState, useRef, useEffect } from 'react'
import { useWorkspaceStore, type Tab } from '../../store/workspace'
import ContextMenu from '../ui/ContextMenu'
import { getSwatch } from '../../lib/colors'

interface MenuState {
  x: number
  y: number
  tab: Tab
}

const BAR_BG = '#d8d6d1'        // Chrome-bar grey
const ACTIVE_TAB_BG = '#fafafa' // matches the canvas surface below
const INACTIVE_TAB_BG = 'rgba(255,255,255,0.42)'
const INACTIVE_HOVER_BG = 'rgba(255,255,255,0.7)'

export default function TabBar() {
  const {
    sections,
    activeSectionId,
    colorsEnabled,
    addTab,
    removeTab,
    renameTab,
    setActiveTab,
    setTabColor,
  } = useWorkspaceStore()

  const activeSection = sections.find((s) => s.id === activeSectionId)
  const tabs = activeSection?.tabs ?? []
  const activeTabId = activeSection?.activeTabId ?? null

  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [exitingTabIds, setExitingTabIds] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTabId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingTabId])

  const startRename = (tabId: string, name: string) => {
    setEditingTabId(tabId)
    setEditName(name)
  }

  const commitRename = () => {
    if (editingTabId && editName.trim() && activeSectionId) {
      renameTab(activeSectionId, editingTabId, editName.trim())
    }
    setEditingTabId(null)
  }

  const handleAddTab = () => {
    if (!activeSectionId) return
    const count = tabs.length + 1
    addTab(activeSectionId, `Canvas ${count}`)
  }

  const handleCloseTab = (tabId: string) => {
    if (!activeSectionId) return
    setExitingTabIds((prev) => new Set(prev).add(tabId))
    window.setTimeout(() => {
      removeTab(activeSectionId, tabId)
      setExitingTabIds((prev) => {
        const next = new Set(prev)
        next.delete(tabId)
        return next
      })
    }, 220)
  }

  return (
    <div
      style={{
        height: 40,
        minHeight: 40,
        background: BAR_BG,
        display: 'flex',
        alignItems: 'flex-end',
        overflow: 'hidden',
        userSelect: 'none',
        padding: '6px 8px 0',
        gap: 2,
        // No bottom border — the active tab will poke down 1px to "merge" with the canvas.
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        position: 'relative',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-end',
          overflowX: 'auto',
          overflowY: 'hidden',
          gap: 2,
          minWidth: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const isExiting = exitingTabIds.has(tab.id)
          const swatch = colorsEnabled ? getSwatch(tab.color) : null

          // Chrome aesthetic: full tab body matches the canvas color when active.
          // Color choice shows as a thin stripe across the top of the tab.
          const tabBg = isActive ? ACTIVE_TAB_BG : INACTIVE_TAB_BG
          const stripe = swatch ? swatch.base : 'transparent'
          const ink = isActive ? '#1a1a1a' : '#5a5854'

          return (
            <div
              key={tab.id}
              onClick={() => !isExiting && activeSectionId && setActiveTab(activeSectionId, tab.id)}
              onDoubleClick={() => startRename(tab.id, tab.name)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, tab })
              }}
              className="chrome-tab"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 14,
                paddingRight: 10,
                height: 34,
                minWidth: 100,
                maxWidth: 220,
                flex: '1 1 160px',
                fontSize: 12,
                cursor: 'pointer',
                background: tabBg,
                color: ink,
                fontWeight: isActive ? 600 : 500,
                fontFamily: 'system-ui',
                whiteSpace: 'nowrap',
                // Curved top corners, square bottom — classic Chrome.
                borderRadius: '10px 10px 0 0',
                // Active tab pokes 1px down to cover the bar's bottom border, merging with canvas.
                marginBottom: isActive ? -1 : 0,
                // Inactive tabs sit a hair shorter so the active one feels "lifted".
                transform: isActive ? 'translateY(0)' : 'translateY(0)',
                boxShadow: isActive
                  ? '0 -1px 0 rgba(0,0,0,0.08), -1px 0 0 rgba(0,0,0,0.04), 1px 0 0 rgba(0,0,0,0.04)'
                  : 'inset 0 -1px 0 rgba(0,0,0,0.06)',
                zIndex: isActive ? 2 : 1,
                transition:
                  'background 0.15s ease, color 0.15s ease, box-shadow 0.18s ease, max-width 0.22s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.22s ease, padding 0.22s ease, margin 0.22s ease',
                animation: isExiting
                  ? 'chrome-tab-out 0.22s cubic-bezier(0.32, 0.72, 0, 1) both'
                  : 'chrome-tab-in 0.26s cubic-bezier(0.32, 0.72, 0, 1) both',
                overflow: 'hidden',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLDivElement
                if (!isActive) el.style.background = INACTIVE_HOVER_BG
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLDivElement
                if (!isActive) el.style.background = INACTIVE_TAB_BG
              }}
            >
              {/* Color stripe — classic Chrome "tab group" indicator */}
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 8,
                  right: 8,
                  height: 3,
                  background: stripe,
                  borderRadius: '0 0 2px 2px',
                  transition: 'background 0.18s ease',
                  pointerEvents: 'none',
                }}
              />

              {editingTabId === tab.id ? (
                <input
                  ref={inputRef}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setEditingTabId(null)
                  }}
                  style={{
                    background: '#fff',
                    border: '1px solid rgba(0,0,0,0.12)',
                    borderRadius: 4,
                    fontSize: 12,
                    padding: '2px 6px',
                    outline: 'none',
                    color: '#1a1a1a',
                    width: 100,
                    fontFamily: 'system-ui',
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {tab.name}
                </span>
              )}

              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tab.id)
                  }}
                  title="Close tab"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 14,
                    lineHeight: 1,
                    color: '#999',
                    cursor: 'pointer',
                    padding: 0,
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background 0.15s ease, color 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget as HTMLButtonElement
                    el.style.background = 'rgba(0,0,0,0.1)'
                    el.style.color = '#222'
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget as HTMLButtonElement
                    el.style.background = 'transparent'
                    el.style.color = '#999'
                  }}
                >
                  {'\u00D7'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      <button
        onClick={handleAddTab}
        title="New tab"
        style={{
          background: 'transparent',
          border: 'none',
          width: 28,
          height: 28,
          marginBottom: 3,
          marginLeft: 4,
          fontSize: 18,
          color: '#5a5854',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 999,
          flexShrink: 0,
          fontFamily: 'system-ui',
          transition: 'background 0.15s ease, color 0.15s ease, transform 0.18s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'rgba(0,0,0,0.07)'
          el.style.color = '#1a1a1a'
          el.style.transform = 'rotate(90deg)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement
          el.style.background = 'transparent'
          el.style.color = '#5a5854'
          el.style.transform = 'rotate(0deg)'
        }}
      >
        +
      </button>

      {menu && activeSectionId && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            {
              id: 'rename',
              label: 'Rename',
              onSelect: () => startRename(menu.tab.id, menu.tab.name),
            },
            ...(tabs.length > 1
              ? [{
                  id: 'close',
                  label: 'Close tab',
                  onSelect: () => handleCloseTab(menu.tab.id),
                }]
              : []),
          ]}
          colorPicker={{
            currentColor: menu.tab.color,
            surface: 'light',
            onPick: (id) => setTabColor(activeSectionId, menu.tab.id, id),
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
