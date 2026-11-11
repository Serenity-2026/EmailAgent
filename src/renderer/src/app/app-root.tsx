import React, { useEffect, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import type { ThemeMode } from '../../../shared/models'
import { EmailApp } from './email-app'

export function AppRoot(): React.JSX.Element {
  const [mode, setMode] = useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (): void => setSystemDark(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const dark = mode === 'dark' || (mode === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    ConfigProvider.config({ theme: { algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm } })
  }, [dark])
  return <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <EmailApp themeMode={mode} setThemeMode={setMode} dark={dark} />
  </ConfigProvider>
}
