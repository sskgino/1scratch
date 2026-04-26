import type { ReactNode } from 'react'

export interface SettingsRowProps {
  label: string
  control: ReactNode
}

export function SettingsRow({ label, control }: SettingsRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ flex: 1, fontSize: 15 }}>{label}</span>
      {control}
    </div>
  )
}
