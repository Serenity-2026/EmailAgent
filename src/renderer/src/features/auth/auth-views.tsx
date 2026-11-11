import React from 'react'
import { Alert, Button, Input, Spin } from 'antd'

export function LaunchView(): React.JSX.Element {
  return <div className="launch-screen"><div className="recovery-card"><Spin /><p>正在启动邮件服务…</p></div></div>
}

export function ConnectionErrorView({ error, busy, onRetry }: {
  error: string; busy: boolean; onRetry: () => void
}): React.JSX.Element {
  return <div className="recovery-shell"><div className="recovery-card">
    <div className="brand">Email<span>Agent</span></div>
    <h1>无法连接服务</h1>
    {error && <Alert type="error" message={error} style={{ marginBottom: 18 }} />}
    <Button type="primary" loading={busy} onClick={onRetry}>重新连接</Button>
  </div></div>
}

export function LoginView({ error, username, password, busy, onUsername, onPassword, onLogin }: {
  error: string; username: string; password: string; busy: boolean
  onUsername: (value: string) => void; onPassword: (value: string) => void; onLogin: () => void
}): React.JSX.Element {
  return <div className="recovery-shell"><div className="recovery-card">
    <div className="brand">Email<span>Agent</span></div>
    <h1>登录</h1>
    {error && <Alert type="error" message={error} style={{ marginBottom: 18 }} />}
    <div className="field"><label>账号</label><Input value={username} onChange={(event) => onUsername(event.target.value)} /></div>
    <div className="field"><label>密码</label><Input.Password value={password}
      onChange={(event) => onPassword(event.target.value)} onPressEnter={onLogin} /></div>
    <Button type="primary" loading={busy} block onClick={onLogin}>登录</Button>
  </div></div>
}
