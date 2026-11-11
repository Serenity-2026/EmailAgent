import React from 'react'
import { Alert, Button, Input, Modal, Select, Switch } from 'antd'
import type { AccountInput, AiSettingsInput, Provider, ThemeMode } from '../../../../shared/models'

export function SettingsDialogs({ error, themeMode, accountSettingsOpen, accountOpen, accountBusy, accountForm,
  userOpen, userBusy, newUserName, newUserPassword, confirmPassword,
  passwordOpen, passwordBusy, currentPassword, nextPassword, confirmNextPassword,
  aiOpen, aiBusy, aiSettings, hasAiKey, models, modelsLoading, notice, hasAccount,
  onTheme, onAccountSettingsOpen, onOpenAi, onOpenAccount, onOpenUser, onOpenPassword, onRemoveAccount, onLogout,
  onAccountOpen, onAccountForm, onAddAccount, onUserOpen, onNewUserName, onNewUserPassword, onConfirmPassword,
  onCreateUser, onPasswordOpen, onCurrentPassword, onNextPassword, onConfirmNextPassword, onChangePassword,
  onAiOpen, onAiSettings, onModels, onLoadModels, onSaveAi }: {
  error: string; themeMode: ThemeMode; accountSettingsOpen: boolean; accountOpen: boolean; accountBusy: boolean
  accountForm: AccountInput; userOpen: boolean; userBusy: boolean; newUserName: string; newUserPassword: string
  confirmPassword: string; passwordOpen: boolean; passwordBusy: boolean; currentPassword: string
  nextPassword: string; confirmNextPassword: string; aiOpen: boolean; aiBusy: boolean
  aiSettings: AiSettingsInput; hasAiKey: boolean; models: string[]; modelsLoading: boolean; notice: string
  hasAccount: boolean; onTheme: (mode: ThemeMode) => void; onAccountSettingsOpen: (open: boolean) => void
  onOpenAi: () => void; onOpenAccount: () => void; onOpenUser: () => void; onOpenPassword: () => void
  onRemoveAccount: () => Promise<void>; onLogout: () => void; onAccountOpen: (open: boolean) => void
  onAccountForm: (value: AccountInput) => void; onAddAccount: () => void; onUserOpen: (open: boolean) => void
  onNewUserName: (value: string) => void; onNewUserPassword: (value: string) => void
  onConfirmPassword: (value: string) => void; onCreateUser: () => void; onPasswordOpen: (open: boolean) => void
  onCurrentPassword: (value: string) => void; onNextPassword: (value: string) => void
  onConfirmNextPassword: (value: string) => void; onChangePassword: () => void; onAiOpen: (open: boolean) => void
  onAiSettings: (value: AiSettingsInput) => void; onModels: (models: string[]) => void
  onLoadModels: () => void; onSaveAi: () => void
}): React.JSX.Element {
  return <>
    <Modal open={accountSettingsOpen} title="设置" footer={null} onCancel={() => onAccountSettingsOpen(false)} destroyOnHidden>
      <div className="account-settings">
        <div className="field"><label>主题</label><Select value={themeMode}
          options={[{ label: '跟随系统', value: 'system' }, { label: '亮色', value: 'light' }, { label: '暗色', value: 'dark' }]}
          onChange={onTheme} /></div>
        <Button onClick={onOpenAi}>AI 设置</Button>
        <Button onClick={onOpenAccount}>添加邮箱</Button>
        <Button onClick={onOpenUser}>添加用户</Button>
        <Button onClick={onOpenPassword}>修改密码</Button>
        <Button danger disabled={!hasAccount} onClick={() => { onAccountSettingsOpen(false); Modal.confirm({
          title: '移除当前邮箱？', content: '只删除本机保存的账户和授权码，不会删除服务器上的邮件。',
          okText: '移除', cancelText: '取消', okButtonProps: { danger: true }, onOk: onRemoveAccount
        }) }}>移除当前邮箱</Button>
        <Button onClick={onLogout}>退出登录</Button>
      </div>
    </Modal>

    <Modal open={accountOpen} title="添加邮箱" footer={null} onCancel={() => onAccountOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>邮箱服务商</label>
        <Select value={accountForm.provider} options={[{ label: 'QQ 邮箱', value: 'qq' }, { label: '163 邮箱', value: '163' }]}
          onChange={(provider: Provider) => onAccountForm({ ...accountForm, provider, address: '' })} /></div>
      <div className="field"><label>邮箱地址</label><Input value={accountForm.address}
        placeholder={accountForm.provider === 'qq' ? 'name@qq.com' : 'name@163.com'}
        onChange={(event) => onAccountForm({ ...accountForm, address: event.target.value })} /></div>
      <div className="field"><label>客户端授权码</label><Input.Password value={accountForm.authorizationCode} placeholder="从邮箱设置中获取"
        onChange={(event) => onAccountForm({ ...accountForm, authorizationCode: event.target.value })} />
        <span className="field-help">请先在邮箱网页设置中开启 IMAP/SMTP。</span></div>
      <div className="modal-actions"><Button onClick={() => onAccountOpen(false)}>取消</Button>
        <Button type="primary" loading={accountBusy} onClick={onAddAccount}>测试并添加</Button></div>
    </Modal>

    <Modal open={userOpen} title="添加用户" footer={null} onCancel={() => onUserOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>账号</label><Input value={newUserName} onChange={(event) => onNewUserName(event.target.value)} /></div>
      <div className="field"><label>密码</label><Input.Password value={newUserPassword} onChange={(event) => onNewUserPassword(event.target.value)} /></div>
      <div className="field"><label>确认密码</label><Input.Password value={confirmPassword} onChange={(event) => onConfirmPassword(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => onUserOpen(false)}>取消</Button>
        <Button type="primary" loading={userBusy} onClick={onCreateUser}>创建用户</Button></div>
    </Modal>

    <Modal open={passwordOpen} title="修改密码" footer={null} onCancel={() => onPasswordOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>当前密码</label><Input.Password value={currentPassword} onChange={(event) => onCurrentPassword(event.target.value)} /></div>
      <div className="field"><label>新密码</label><Input.Password value={nextPassword} onChange={(event) => onNextPassword(event.target.value)} /></div>
      <div className="field"><label>确认新密码</label><Input.Password value={confirmNextPassword} onChange={(event) => onConfirmNextPassword(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => onPasswordOpen(false)}>取消</Button>
        <Button type="primary" loading={passwordBusy} onClick={onChangePassword}>保存新密码</Button></div>
    </Modal>

    <Modal open={aiOpen} title="AI 设置" footer={null} onCancel={() => onAiOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {notice && <Alert type="info" message={notice} style={{ marginBottom: 16 }} />}
      <div className="field"><label>接口基础地址</label><Input value={aiSettings.baseUrl} placeholder="https://example.com/v1"
        onChange={(event) => { onAiSettings({ ...aiSettings, baseUrl: event.target.value, model: '' }); onModels([]) }} /></div>
      <div className="field"><label>API Key</label><Input.Password value={aiSettings.apiKey}
        placeholder={hasAiKey ? '已保存，留空则保持不变' : '输入 API Key'}
        onChange={(event) => { onAiSettings({ ...aiSettings, apiKey: event.target.value, model: '' }); onModels([]) }} /></div>
      <div className="field"><label>模型</label><div className="model-picker">
        <Select showSearch value={aiSettings.model || undefined} placeholder="先加载模型" disabled={!models.length}
          options={models.map((model) => ({ label: model, value: model }))}
          onChange={(model: string) => onAiSettings({ ...aiSettings, model })} />
        <Button loading={modelsLoading} onClick={onLoadModels}>加载模型</Button>
      </div></div>
      <p className="field-help">生成摘要时，邮件正文片段会发送给你配置的 AI 服务。</p>
      <div className="field"><label>每日摘要时间</label><Input type="time" value={aiSettings.dailyTime}
        onChange={(event) => onAiSettings({ ...aiSettings, dailyTime: event.target.value })} /></div>
      <div className="field"><label>应用运行时自动生成</label><Switch checked={aiSettings.autoDaily}
        onChange={(checked) => onAiSettings({ ...aiSettings, autoDaily: checked })} /></div>
      <div className="modal-actions"><Button onClick={() => onAiOpen(false)}>取消</Button>
        <Button type="primary" loading={aiBusy} disabled={!aiSettings.model} onClick={onSaveAi}>保存配置</Button></div>
    </Modal>
  </>
}
