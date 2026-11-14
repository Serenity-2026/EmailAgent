import React, { useEffect, useState } from 'react'
import { ConfigProvider, theme } from 'antd'
import type { ThemeMode } from '../../../shared/models'
import { EmailApp } from './email-app'

const fontFamily = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, sans-serif'

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
  }, [dark])
  return <ConfigProvider theme={{
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#9db4ea' : '#1e3f8f',
      colorInfo: dark ? '#9db4ea' : '#1e3f8f',
      colorLink: dark ? '#9db4ea' : '#1e3f8f',
      colorBgBase: dark ? '#171610' : '#f2efe6',
      colorBgContainer: dark ? '#1d1c15' : '#faf8f1',
      colorBgElevated: dark ? '#222016' : '#faf8f1',
      colorTextBase: dark ? '#f1ede1' : '#1a1915',
      colorBorder: dark ? '#3a372a' : '#d8d1bf',
      colorBorderSecondary: dark ? '#2e2c22' : '#e4ddcb',
      borderRadius: 6,
      fontFamily,
      fontSize: 13,
      controlHeight: 32
    }
  }}>
    <EmailApp themeMode={mode} setThemeMode={setMode} dark={dark} />
  </ConfigProvider>
}
