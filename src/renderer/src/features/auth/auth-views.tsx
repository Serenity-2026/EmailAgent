import React from 'react'
import { Alert, Button, Input, Spin } from 'antd'
import { Icon } from '../../icons'

export function LaunchView(): React.JSX.Element {
  return <div className="launch-screen"><div className="recovery-card"><Spin /><p>正在启动邮件服务…</p></div></div>
}

export function ConnectionErrorView({ error, busy, onRetry }: {
  error: string; busy: boolean; onRetry: () => void
}): React.JSX.Element {
  return <div className="recovery-shell"><div className="recovery-card">
    <div className="brand"><Icon name="mail" size={19} /><span className="brand-word">Email<span>Agent</span></span></div>
    <h1>无法连接服务</h1>
    {error && <Alert type="error" title={error} style={{ marginBottom: 18 }} />}
    <Button type="primary" loading={busy} onClick={onRetry}>重新连接</Button>
  </div></div>
}

export function LoginView({ error, username, password, busy, demoMode, onUsername, onPassword, onLogin }: {
  error: string; username: string; password: string; busy: boolean; demoMode: boolean
  onUsername: (value: string) => void; onPassword: (value: string) => void; onLogin: () => void
}): React.JSX.Element {
  return <div className="recovery-shell"><div className="recovery-card">
    <div className="brand"><Icon name="mail" size={19} /><span className="brand-word">Email<span>Agent</span></span></div>
    <h1>登录</h1>
    {demoMode && <Alert type="warning" title="当前为演示模式，仅用于课程演示，请勿保存真实邮箱凭据。" style={{ marginBottom: 18 }} />}
    {error && <Alert type="error" title={error} style={{ marginBottom: 18 }} />}
    <div className="field"><label>账号</label><Input value={username} onChange={(event) => onUsername(event.target.value)} /></div>
    <div className="field"><label>密码</label><Input.Password value={password}
      onChange={(event) => onPassword(event.target.value)} onPressEnter={onLogin} /></div>
    <Button type="primary" loading={busy} block onClick={onLogin}>登录</Button>
  </div></div>
}

export function BootstrapView({ error, username, password, confirm, busy,
  onUsername, onPassword, onConfirm, onCreate }: {
  error: string; username: string; password: string; confirm: string; busy: boolean
  onUsername: (value: string) => void; onPassword: (value: string) => void
  onConfirm: (value: string) => void; onCreate: () => void
}): React.JSX.Element {
  return <div className="recovery-shell"><div className="recovery-card">
    <div className="brand"><Icon name="mail" size={19} /><span className="brand-word">Email<span>Agent</span></span></div>
    <h1>创建首位管理员</h1>
    <p>这是全新数据库。请创建管理员账号，密码至少 8 位。</p>
    {error && <Alert type="error" title={error} style={{ marginBottom: 18 }} />}
    <div className="field"><label>管理员账号</label><Input value={username} onChange={(event) => onUsername(event.target.value)} /></div>
    <div className="field"><label>密码</label><Input.Password value={password} onChange={(event) => onPassword(event.target.value)} /></div>
    <div className="field"><label>确认密码</label><Input.Password value={confirm}
      onChange={(event) => onConfirm(event.target.value)} onPressEnter={onCreate} /></div>
    <Button type="primary" loading={busy} block onClick={onCreate}>创建并登录</Button>
  </div></div>
}
