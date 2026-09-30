import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import type { AccountInput, AiSettingsInput, DailyDigest, MailDraft } from '../shared/models'
import { generateDigest as summarize, generateDraft, listAiModels, resolveAiKey, testAiConnection, validateAiSettings } from './ai'
import { getMail, getSentFolder, listMail, sendMail, testAccount, todayMail } from './mail'
import { validateAccount } from './providers'
import { Store, type StoredAccount } from './store'

let window: BrowserWindow | null = null
let store: Store
let dailyAttempt = ''
let initialized = false
const ownsInstance = app.requestSingleInstanceLock()

if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

function accountById(id: string): StoredAccount {
  const account = store.accounts.find((item) => item.id === id)
  if (!account) throw new Error('邮箱账户不存在')
  return account
}

function requireSession(version: number): void {
  if (store.sessionVersion !== version || !store.activeUsername) throw new Error('登录状态已变化，请重试')
}

function todayStart(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

function localDate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

async function digestFor(accountIds: string[]): Promise<DailyDigest> {
  const version = store.sessionVersion
  const settings = store.ai
  const selected = accountIds.map(accountById)
  if (selected.length === 0) throw new Error('请先添加邮箱账户')
  const mail = (await Promise.all(selected.map((account) => todayMail(account, todayStart()))))
    .flat().sort((a, b) => a.date.localeCompare(b.date))
  requireSession(version)
  const digest = await summarize(settings, localDate(), mail)
  requireSession(version)
  return digest
}

function registerIpc(): void {
  ipcMain.handle('auth:session', () => ({ username: store.activeUsername, needsReset: store.needsReset }))
  ipcMain.handle('auth:login', (_event, username: string, password: string) => store.login(username, password))
  ipcMain.handle('auth:logout', () => store.logout())
  ipcMain.handle('auth:create', (_event, username: string, password: string) => store.addUser(username, password))
  ipcMain.handle('auth:password', (_event, currentPassword: string, nextPassword: string) =>
    store.changePassword(currentPassword, nextPassword))
  ipcMain.handle('storage:retry', async () => {
    return { needsReset: await store.retryUnreadable() }
  })
  ipcMain.handle('storage:reset', () => store.resetUnreadable())
  ipcMain.handle('accounts:list', () => store.accounts.map(({ authorizationCode: _code, ...account }) => account))
  ipcMain.handle('accounts:add', async (_event, input: AccountInput) => {
    const version = store.sessionVersion
    validateAccount(input)
    if (store.accounts.some((account) => account.address.toLowerCase() === input.address.trim().toLowerCase())) {
      throw new Error('这个邮箱已经添加')
    }
    const account: StoredAccount = {
      id: randomUUID(),
      provider: input.provider,
      address: input.address.trim().toLowerCase(),
      authorizationCode: input.authorizationCode.trim()
    }
    try {
      await testAccount(account)
    } catch {
      throw new Error('连接失败，请检查 IMAP/SMTP 是否开启及授权码是否正确')
    }
    requireSession(version)
    await store.setAccounts([...store.accounts, account])
    const { authorizationCode: _code, ...view } = account
    return view
  })
  ipcMain.handle('accounts:remove', async (_event, id: string) => {
    accountById(id)
    await store.setAccounts(store.accounts.filter((account) => account.id !== id))
  })
  ipcMain.handle('mail:list', async (_event, accountId: string, folder: string) => {
    const version = store.sessionVersion
    const result = await listMail(accountById(accountId), folder)
    requireSession(version)
    return result
  })
  ipcMain.handle('mail:get', async (_event, accountId: string, folder: string, uid: number) => {
    const version = store.sessionVersion
    const result = await getMail(accountById(accountId), folder, uid)
    requireSession(version)
    return result
  })
  ipcMain.handle('mail:open-link', async (event, value: string) => {
    if (!store.activeUsername) throw new Error('请先登录')
    if (event.senderFrame !== window?.webContents.mainFrame || typeof value !== 'string') throw new Error('链接无效')
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('仅支持打开 HTTPS 链接')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle('mail:sent-folder', async (_event, accountId: string) => {
    const version = store.sessionVersion
    const result = await getSentFolder(accountById(accountId))
    requireSession(version)
    return result
  })
  ipcMain.handle('mail:send', (_event, draft: MailDraft) => sendMail(accountById(draft.accountId), draft))
  ipcMain.handle('ai:settings:get', () => {
    const { apiKey: _key, ...view } = store.ai
    return { ...view, hasApiKey: Boolean(store.ai.apiKey) }
  })
  ipcMain.handle('ai:models', (_event, baseUrl: string, apiKey: string) =>
    listAiModels(baseUrl.trim(), resolveAiKey(baseUrl, apiKey, store.ai)))
  ipcMain.handle('ai:settings:save', async (_event, input: AiSettingsInput) => {
    const version = store.sessionVersion
    const settings = {
      ...input,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ''),
      model: input.model.trim(),
      apiKey: resolveAiKey(input.baseUrl, input.apiKey, store.ai)
    }
    validateAiSettings(settings)
    await testAiConnection(settings)
    requireSession(version)
    await store.setAi(settings)
  })
  ipcMain.handle('ai:settings:test', () => testAiConnection(store.ai))
  ipcMain.handle('ai:draft', async (_event, instruction: string, accountId: string) => {
    const version = store.sessionVersion
    accountById(accountId)
    const draft = await generateDraft(store.ai, instruction, accountId)
    requireSession(version)
    return draft
  })
  ipcMain.handle('ai:digest', (_event, accountIds: string[]) => digestFor(accountIds))
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'EmailAgent',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function startDailySchedule(): void {
  setInterval(async () => {
    if (!store.activeUsername || store.needsReset) return
    const settings = store.ai
    if (!settings.autoDaily || !settings.apiKey || store.accounts.length === 0 || !window || window.isDestroyed()) return
    const now = new Date()
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const date = localDate()
    if (clock < settings.dailyTime || dailyAttempt === date) return
    dailyAttempt = date
    try {
      const version = store.sessionVersion
      const digest = await digestFor(store.accounts.map((account) => account.id))
      if (store.sessionVersion === version) window?.webContents.send('ai:digest:ready', digest)
    } catch {
      // Manual generation remains available if the scheduled run fails.
    }
  }, 60_000)
}

if (ownsInstance) app.whenReady().then(async () => {
  try {
    store = new Store(app.getPath('userData'))
    await store.load()
    registerIpc()
    initialized = true
    createWindow()
    startDailySchedule()
  } catch (error) {
    dialog.showErrorBox('EmailAgent 无法启动', error instanceof Error ? error.message : '未知错误')
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (ownsInstance && initialized && BrowserWindow.getAllWindows().length === 0) createWindow()
})
