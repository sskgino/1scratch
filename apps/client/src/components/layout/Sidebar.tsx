import { useState, useRef, useEffect } from 'react'
import { useWorkspaceStore } from '../../store/workspace'
import SettingsPanel from '../ui/SettingsPanel'
import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'
import { getSwatch } from '../../lib/colors'
import type { Section } from '../../store/workspace'

interface MenuState {
  x: number
  y: number
  section: Section
}

export default function Sidebar() {
  const {
    sections,
    activeSectionId,
    sidebarCollapsed,
    colorsEnabled,
    setActiveSection,
    addSection,
    removeSection,
    renameSection,
    setSectionColor,
    toggleSidebar,
  } = useWorkspaceStore()

  const [showSettings, setShowSettings] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)

  const startRename = (section: Section) => {
    setEditingId(section.id)
    setEditName(section.name)
  }

  const startRenameById = (id: string) => {
    const section = sections.find((s) => s.id === id)
    if (section) startRename(section)
  }

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameSection(editingId, editName.trim())
    }
    setEditingId(null)
  }

  const handleAddSection = () => {
    const count = sections.length + 1
    addSection(`Section ${count}`)
  }

  const buildMenuItems = (section: Section): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [
      {
        id: 'rename',
        label: 'Rename',
        onSelect: () => startRenameById(section.id),
      },
    ]
    if (!section.permanent) {
      items.push({
        id: 'delete',
        label: 'Delete section',
        destructive: true,
        onSelect: () => removeSection(section.id),
      })
    }
    return items
  }

  return (
    <div
      style={{
        width: sidebarCollapsed ? 52 : 212,
        minWidth: sidebarCollapsed ? 52 : 212,
        height: '100%',
        background: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        // Smoother spring-like easing for the collapse.
        transition: 'width 0.32s cubic-bezier(0.32, 0.72, 0, 1), min-width 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Collapse toggle */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
          padding: sidebarCollapsed ? 0 : '0 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        {!sidebarCollapsed && (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#888',
              letterSpacing: '0.05em',
              opacity: sidebarCollapsed ? 0 : 1,
              transition: 'opacity 0.18s ease 0.08s',
            }}
          >
            SCRATCH
          </span>
        )}
        <button
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={iconBtnStyle}
        >
          <span
            style={{
              display: 'inline-block',
              transition: 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
              transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            }}
          >
            {'\u25B6'}
          </span>
        </button>
      </div>

      {/* Section list */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 8px' }}>
        {sections.map((section) => (
          <SidebarItem
            key={section.id}
            section={section}
            active={section.id === activeSectionId}
            collapsed={sidebarCollapsed}
            colorsEnabled={colorsEnabled}
            editing={editingId === section.id}
            editName={editName}
            onEditNameChange={setEditName}
            onClick={() => setActiveSection(section.id)}
            onDoubleClick={() => startRename(section)}
            onContextMenu={(x, y) => setMenu({ x, y, section })}
            onCommitRename={commitRename}
          />
        ))}
      </div>

      {/* Bottom actions */}
      <div
        style={{
          flexShrink: 0,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: sidebarCollapsed ? '8px 0' : '8px 10px',
          display: 'flex',
          flexDirection: sidebarCollapsed ? 'column' : 'row',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <button
          onClick={handleAddSection}
          title="New section"
          style={iconBtnStyle}
        >
          +
        </button>
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Settings"
          style={{ ...iconBtnStyle, ...(!sidebarCollapsed && { marginLeft: 'auto' }) }}
        >
          {'\u2699'}
        </button>
      </div>

      {showSettings && <SettingsPopover onClose={() => setShowSettings(false)} />}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.section)}
          colorPicker={{
            currentColor: menu.section.color,
            surface: 'dark',
            onPick: (id) => setSectionColor(menu.section.id, id),
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function SidebarItem({
  section,
  active,
  collapsed,
  colorsEnabled,
  editing,
  editName,
  onEditNameChange,
  onClick,
  onDoubleClick,
  onContextMenu,
  onCommitRename,
}: {
  section: Section
  active: boolean
  collapsed: boolean
  colorsEnabled: boolean
  editing: boolean
  editName: string
  onEditNameChange: (v: string) => void
  onClick: () => void
  onDoubleClick: () => void
  onContextMenu: (x: number, y: number) => void
  onCommitRename: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const initial = section.name.charAt(0).toUpperCase()
  const swatch = colorsEnabled ? getSwatch(section.color) : null

  // Background: tinted swatch when colored, else neutral active/hover state.
  const tintedBg = swatch ? swatch.baseDark : null
  const restingBg = tintedBg ?? (active ? 'rgba(255,255,255,0.08)' : 'transparent')

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e.clientX, e.clientY)
      }}
      className="sidebar-pill"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: collapsed ? 0 : 9,
        padding: collapsed ? '8px 0' : '8px 12px',
        margin: '3px 0',
        justifyContent: collapsed ? 'center' : 'flex-start',
        cursor: 'pointer',
        background: restingBg,
        // Pill shape
        borderRadius: 999,
        border: active
          ? `1px solid ${swatch ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.18)'}`
          : '1px solid transparent',
        color: swatch ? '#fff' : (active ? '#e8e8e8' : '#9a9a9a'),
        fontSize: 13,
        transition: 'background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s cubic-bezier(0.32, 0.72, 0, 1)',
        boxShadow: active && swatch
          ? `0 1px 0 rgba(255,255,255,0.08) inset, 0 4px 14px ${swatch.baseDark}55`
          : 'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.transform = 'translateX(2px)'
        if (!active && !tintedBg) el.style.background = 'rgba(255,255,255,0.05)'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement
        el.style.transform = 'translateX(0)'
        if (!active && !tintedBg) el.style.background = 'transparent'
      }}
    >
      {/* Initial bubble — sits inside the pill */}
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: swatch
            ? 'rgba(255,255,255,0.22)'
            : (active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
          fontFamily: 'system-ui',
          color: swatch ? '#fff' : 'inherit',
        }}
      >
        {initial}
      </span>

      {!collapsed && (
        editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename()
              if (e.key === 'Escape') onCommitRename()
            }}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.18)',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 999,
              color: '#fff',
              fontSize: 13,
              padding: '2px 8px',
              outline: 'none',
              minWidth: 0,
              fontFamily: 'system-ui',
            }}
          />
        ) : (
          <span style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'system-ui',
          }}>
            {section.name}
          </span>
        )
      )}
    </div>
  )
}

function SettingsPopover({ onClose }: { onClose: () => void }) {
  return <SettingsPanel onClose={onClose} />
}

const iconBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 13,
  cursor: 'pointer',
  width: 28,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 999,
  fontFamily: 'system-ui',
  transition: 'background 0.15s ease, color 0.15s ease',
}
