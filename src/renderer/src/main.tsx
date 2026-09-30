import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Alert, Button, Empty, Input, Modal, Select, Spin, Switch } from 'antd'
import 'antd/dist/reset.css'
import type {
  Account, AccountInput, AiSettingsInput, DailyDigest, DesktopApi, MailDetail, MailDraft, MailSummary, Provider
} from '../../shared/models'
import './styles.css'

declare global {
  interface Window { emailAgent: DesktopApi }
}

const emptyDraft = (accountId: string): MailDraft => ({ accountId, to: '', subject: '', text: '' })
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error)
const dateText = (date: string): string => new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date(date))

function EmailApp(): React.JSX.Element {
  const api = window.emailAgent
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [folder, setFolder] = useState('INBOX')
  const [view, setView] = useState<'mail' | 'digest'>('mail')
  const [mails, setMails] = useState<MailSummary[]>([])
  const [selected, setSelected] = useState<MailSummary | null>(null)
  const [detail, setDetail] = useState<MailDetail | null>(null)
  const [mailLoading, setMailLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [digest, setDigest] = useState<DailyDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)
  const [error, setError] = useState('')
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountBusy, setAccountBusy] = useState(false)
  const [accountForm, setAccountForm] = useState<AccountInput>({ provider: 'qq', address: '', authorizationCode: '' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settings, setSettings] = useState<AiSettingsInput>({ baseUrl: '', model: '', apiKey: '', dailyTime: '09:00', autoDaily: false })
  const [hasAiKey, setHasAiKey] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composePreview, setComposePreview] = useState(false)
  const [composeBusy, setComposeBusy] = useState(false)
  const [draft, setDraft] = useState<MailDraft>(emptyDraft(''))
  const pendingSource = useRef<MailSummary | null>(null)

  useEffect(() => {
    void api.listAccounts().then((items) => {
      setAccounts(items)
      if (items.length) setAccountId(items[0].id)
    }).catch((err) => setError(errorText(err)))
    const unsubscribe = api.onDailyDigest((result) => {
      setDigest(result)
      setView('digest')
    })
    return unsubscribe
  }, [api])

  useEffect(() => {
    if (!accountId || view !== 'mail') return
    let cancelled = false
    setMailLoading(true)
    setSelected(null)
    setDetail(null)
    void api.listMail(accountId, folder).then((items) => {
      if (!cancelled) {
        setMails(items)
        const source = pendingSource.current
        if (source && source.accountId === accountId && source.folder === folder) {
          pendingSource.current = null
          void openMail(source)
        }
      }
    }).catch((err) => {
      if (!cancelled) setError(errorText(err))
    }).finally(() => {
      if (!cancelled) setMailLoading(false)
    })
    return () => { cancelled = true }
  }, [api, accountId, folder, refreshTick, view])

  const activeAccount = accounts.find((account) => account.id === accountId)

  async function openMail(mail: MailSummary): Promise<void> {
    setSelected(mail)
    setDetail(null)
    setDetailLoading(true)
    try {
      const result = await api.getMail(mail.accountId, mail.folder, mail.uid)
      setDetail(result)
      setMails((items) => items.map((item) => item.uid === mail.uid ? { ...item, unread: false } : item))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setDetailLoading(false)
    }
  }

  async function showSent(): Promise<void> {
    if (!accountId) return
    try {
      const sent = await api.getSentFolder(accountId)
      if (!sent) throw new Error('邮箱服务商没有提供可识别的已发送文件夹')
      setFolder(sent)
      setView('mail')
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function addAccount(): Promise<void> {
    setAccountBusy(true)
    setError('')
    try {
      const added = await api.addAccount(accountForm)
      setAccounts((items) => [...items, added])
      setAccountId(added.id)
      setFolder('INBOX')
      setView('mail')
      setAccountOpen(false)
      setAccountForm({ provider: 'qq', address: '', authorizationCode: '' })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setAccountBusy(false)
    }
  }

  async function removeAccount(): Promise<void> {
    if (!accountId) return
    setError('')
    try {
      await api.removeAccount(accountId)
      const remaining = accounts.filter((account) => account.id !== accountId)
      setAccounts(remaining)
      setAccountId(remaining[0]?.id || '')
      setFolder('INBOX')
      setMails([])
      setDetail(null)
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function openSettings(): Promise<void> {
    setError('')
    try {
      const current = await api.getAiSettings()
      setSettings({ baseUrl: current.baseUrl, model: current.model, apiKey: '',
        dailyTime: current.dailyTime, autoDaily: current.autoDaily })
      setHasAiKey(current.hasApiKey)
      setSettingsOpen(true)
    } catch (err) {
      setError(errorText(err))
    }
  }

  async function saveSettings(): Promise<void> {
    setSettingsBusy(true)
    setError('')
    try {
      await api.saveAiSettings(settings)
      setHasAiKey(true)
      await api.testAiConnection()
      setSettingsOpen(false)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setSettingsBusy(false)
    }
  }

  function newMessage(reply = false): void {
    setError('')
    const recipient = reply && detail ? (detail.from.match(/<([^>]+)>/)?.[1] || detail.from) : ''
    setDraft({
      ...emptyDraft(accountId),
      to: recipient,
      subject: reply && detail ? (detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`) : '',
      replyTo: reply && detail ? { uid: detail.uid, folder: detail.folder } : undefined
    })
    setComposePreview(false)
    setComposeOpen(true)
  }

  async function generateMailDraft(): Promise<void> {
    setPromptBusy(true)
    setError('')
    try {
      const result = await api.generateDraft(prompt, accountId)
      setDraft(result)
      setComposePreview(false)
      setPromptOpen(false)
      setComposeOpen(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPromptBusy(false)
    }
  }

  async function send(): Promise<void> {
    setComposeBusy(true)
    setError('')
    try {
      await api.sendMail(draft)
      setComposeOpen(false)
      setComposePreview(false)
      setRefreshTick((value) => value + 1)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setComposeBusy(false)
    }
  }

  async function createDigest(): Promise<void> {
    setDigestLoading(true)
    setError('')
    setView('digest')
    try {
      setDigest(await api.generateDigest(accounts.map((account) => account.id)))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setDigestLoading(false)
    }
  }

  function openDigestSource(source: MailSummary): void {
    pendingSource.current = source
    setAccountId(source.accountId)
    setFolder(source.folder)
    setView('mail')
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">Email<span>Agent</span></div>
      <button className={`nav-item ${view === 'mail' && folder === 'INBOX' ? 'active' : ''}`}
        onClick={() => { setFolder('INBOX'); setView('mail') }}>收件箱</button>
      <button className={`nav-item ${view === 'mail' && folder !== 'INBOX' ? 'active' : ''}`}
        onClick={() => void showSent()}>已发送</button>
      <button className={`nav-item ${view === 'digest' ? 'active' : ''}`}
        onClick={() => { setView('digest'); if (!digest) void createDigest() }}>今日摘要</button>
      <div className="sidebar-label">邮箱账户</div>
      {accounts.map((account) => <button key={account.id}
        className={`account-item ${account.id === accountId ? 'active' : ''}`}
        onClick={() => { setAccountId(account.id); setFolder('INBOX'); setView('mail') }}>
        <span>{account.address}</span>
      </button>)}
      <div className="sidebar-bottom">
        <Button onClick={() => { setError(''); setAccountOpen(true) }}>添加邮箱</Button>
        <Button onClick={() => void openSettings()}>AI 设置</Button>
        <Button danger disabled={!accountId} onClick={() => Modal.confirm({
          title: '移除当前邮箱？', content: '只删除本机保存的账户和授权码，不会删除服务器上的邮件。',
          okText: '移除', cancelText: '取消', okButtonProps: { danger: true }, onOk: removeAccount
        })}>移除当前邮箱</Button>
      </div>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <div>
          <h1>{view === 'digest' ? '今日摘要' : folder === 'INBOX' ? '收件箱' : '已发送'}</h1>
          <p>{view === 'digest' ? '汇总今天收到的邮件' : activeAccount?.address || '请先添加邮箱账户'}</p>
        </div>
        <div className="topbar-actions">
          {view === 'mail' && <Button onClick={() => setRefreshTick((value) => value + 1)} disabled={!accountId}>刷新</Button>}
          {view === 'digest' && <Button onClick={() => void createDigest()} loading={digestLoading} disabled={!accounts.length}>重新生成</Button>}
          <Button onClick={() => { setError(''); setPrompt(''); setPromptOpen(true) }} disabled={!accountId}>一句话写邮件</Button>
          <Button type="primary" onClick={() => newMessage()} disabled={!accountId}>写邮件</Button>
        </div>
      </header>

      {error && <div className="error-wrap"><Alert type="error" message={error} closable onClose={() => setError('')} /></div>}

      {view === 'digest' ? <section className="digest-view">
        <div className="digest-card">
          <h2>{digest?.date || '今日'}邮件摘要</h2>
          {digestLoading ? <div className="top-spinner"><Spin /></div> : digest ? <>
            <div className="digest-body">{digest.content}</div>
            {digest.sources.length > 0 && <>
              <div className="reader-divider" />
              <h3>来源邮件</h3>
              <div className="digest-sources">{digest.sources.map((source, index) =>
                <button key={`${source.accountId}-${source.uid}`} className="source-row" onClick={() => openDigestSource(source)}>
                  [{index + 1}] {source.subject} · {source.from}
                </button>)}</div>
            </>}
          </> : <Empty description="还没有摘要" />}
        </div>
      </section> : <section className="content">
        <div className="mail-list">
          <div className="mail-list-head"><span>邮件列表</span><span>{mails.length} 封</span></div>
          {mailLoading ? <div className="top-spinner"><Spin /></div> : mails.length ? mails.map((mail) =>
            <button key={`${mail.folder}-${mail.uid}`}
              className={`mail-row ${mail.unread ? 'unread' : ''} ${selected?.uid === mail.uid ? 'selected' : ''}`}
              onClick={() => void openMail(mail)}>
              <div className="mail-row-top"><span className="mail-row-from">{mail.from}</span><span className="mail-row-date">{dateText(mail.date)}</span></div>
              <div className="mail-row-subject">{mail.subject}</div>
            </button>) : <Empty description={accountId ? '没有邮件' : '请先添加邮箱账户'} />}
        </div>
        <div className="reader">
          {detailLoading ? <div className="top-spinner"><Spin /></div> : detail ? <article className="reader-card">
            <h2>{detail.subject}</h2>
            <div className="reader-meta">
              <div><strong>发件人：</strong>{detail.from}</div>
              <div><strong>收件人：</strong>{detail.to}</div>
              <div><strong>时间：</strong>{new Date(detail.date).toLocaleString('zh-CN')}</div>
              {detail.attachmentNames.length > 0 && <div><strong>附件：</strong>{detail.attachmentNames.join('、')}</div>}
            </div>
            <div className="reader-divider" />
            <div className="mail-body">{detail.text}</div>
            <div className="reader-actions"><Button onClick={() => newMessage(true)}>回复</Button></div>
          </article> : <div className="empty-pane"><Empty description="选择一封邮件查看" /></div>}
        </div>
      </section>}
    </main>

    <Modal open={accountOpen} title="添加邮箱" footer={null} onCancel={() => setAccountOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>邮箱服务商</label>
        <Select value={accountForm.provider} options={[{ label: 'QQ 邮箱', value: 'qq' }, { label: '163 邮箱', value: '163' }]}
          onChange={(provider: Provider) => setAccountForm({ ...accountForm, provider, address: '' })} /></div>
      <div className="field"><label>邮箱地址</label><Input value={accountForm.address} placeholder={accountForm.provider === 'qq' ? 'name@qq.com' : 'name@163.com'}
        onChange={(event) => setAccountForm({ ...accountForm, address: event.target.value })} /></div>
      <div className="field"><label>客户端授权码</label><Input.Password value={accountForm.authorizationCode} placeholder="从邮箱设置中获取"
        onChange={(event) => setAccountForm({ ...accountForm, authorizationCode: event.target.value })} />
        <span className="field-help">请先在邮箱网页设置中开启 IMAP/SMTP。</span></div>
      <div className="modal-actions"><Button onClick={() => setAccountOpen(false)}>取消</Button><Button type="primary" loading={accountBusy} onClick={() => void addAccount()}>测试并添加</Button></div>
    </Modal>

    <Modal open={settingsOpen} title="AI 设置" footer={null} onCancel={() => setSettingsOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>接口基础地址</label><Input value={settings.baseUrl} placeholder="https://example.com/v1"
        onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })} /></div>
      <div className="field"><label>模型名称</label><Input value={settings.model} placeholder="模型 ID"
        onChange={(event) => setSettings({ ...settings, model: event.target.value })} /></div>
      <div className="field"><label>API Key</label><Input.Password value={settings.apiKey} placeholder={hasAiKey ? '已保存，留空则保持不变' : '输入 API Key'}
        onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} /></div>
      <p className="field-help">生成摘要时，邮件正文片段会发送给你配置的 AI 服务。</p>
      <div className="field"><label>每日摘要时间</label><Input type="time" value={settings.dailyTime}
        onChange={(event) => setSettings({ ...settings, dailyTime: event.target.value })} /></div>
      <div className="field"><label>应用运行时自动生成</label><Switch checked={settings.autoDaily}
        onChange={(checked) => setSettings({ ...settings, autoDaily: checked })} /></div>
      <div className="modal-actions"><Button onClick={() => setSettingsOpen(false)}>取消</Button><Button type="primary" loading={settingsBusy} onClick={() => void saveSettings()}>保存并测试</Button></div>
    </Modal>

    <Modal open={promptOpen} title="一句话写邮件" footer={null} onCancel={() => setPromptOpen(false)} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <div className="field"><label>写信要求</label><Input.TextArea rows={5} value={prompt}
        placeholder="给 teacher@example.com 写邮件，说明周五提交课程报告，语气礼貌"
        onChange={(event) => setPrompt(event.target.value)} /></div>
      <div className="modal-actions"><Button onClick={() => setPromptOpen(false)}>取消</Button><Button type="primary" loading={promptBusy} onClick={() => void generateMailDraft()}>生成草稿</Button></div>
    </Modal>

    <Modal open={composeOpen} title={composePreview ? '确认发送' : '撰写邮件'} width={700} footer={null}
      onCancel={() => { setComposeOpen(false); setComposePreview(false) }} destroyOnHidden>
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      {!composePreview ? <>
        <div className="field"><label>发件账户</label><Select value={draft.accountId}
          options={accounts.map((account) => ({ label: account.address, value: account.id }))}
          onChange={(value: string) => setDraft({ ...draft, accountId: value })} /></div>
        <div className="field"><label>收件人</label><Input value={draft.to} placeholder="name@example.com"
          onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></div>
        <div className="field"><label>主题</label><Input value={draft.subject}
          onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></div>
        <div className="field"><label>正文</label><Input.TextArea rows={9} value={draft.text}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></div>
        <div className="modal-actions"><Button onClick={() => setComposeOpen(false)}>取消</Button>
          <Button type="primary" onClick={() => setComposePreview(true)}>预览</Button></div>
      </> : <>
        <div className="compose-preview">
          <p><strong>发件人：</strong>{accounts.find((account) => account.id === draft.accountId)?.address}</p>
          <p><strong>收件人：</strong>{draft.to || '未填写'}</p>
          <p><strong>主题：</strong>{draft.subject || '未填写'}</p>
          <div className="reader-divider" />
          <p>{draft.text || '未填写正文'}</p>
        </div>
        <p className="small-note">确认后将立即发送。</p>
        <div className="modal-actions"><Button onClick={() => setComposePreview(false)}>返回编辑</Button>
          <Button type="primary" loading={composeBusy} onClick={() => void send()}>确认发送</Button></div>
      </>}
    </Modal>
  </div>
}

createRoot(document.getElementById('root')!).render(<EmailApp />)
