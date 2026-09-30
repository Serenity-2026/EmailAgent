import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import type { AccountInput, AiSettingsInput, DailyDigest, MailDraft } from '../shared/models'
import { generateDigest as summarize, generateDraft, testAiConnection, validateAiSettings } from './ai'
import { getMail, getSentFolder, listMail, sendMail, testAccount, todayMail } from './mail'
import { validateAccount } from './providers'
import { Store, type StoredAccount } from './store'

let window: BrowserWindow | null = null
let store: Store
let dailyAttempt = ''

function accountById(id: string): StoredAccount {
  const account = store.accounts.find((item) => item.id === id)
  if (!account) throw new Error('邮箱账户不存在')
  return account
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
  const selected = accountIds.map(accountById)
  if (selected.length === 0) throw new Error('请先添加邮箱账户')
  const mail = (await Promise.all(selected.map((account) => todayMail(account, todayStart()))))
    .flat().sort((a, b) => a.date.localeCompare(b.date))
  return summarize(store.ai, localDate(), mail)
}

function registerIpc(): void {
  ipcMain.handle('accounts:list', () => store.accounts.map(({ authorizationCode: _code, ...account }) => account))
  ipcMain.handle('accounts:add', async (_event, input: AccountInput) => {
    validateAccount(input)
    if (store.accounts.some((account) => account.address.toLowerCase() === input.address.toLowerCase())) {
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
    await store.setAccounts([...store.accounts, account])
    const { authorizationCode: _code, ...view } = account
    return view
  })
  ipcMain.handle('accounts:remove', async (_event, id: string) => {
    accountById(id)
    await store.setAccounts(store.accounts.filter((account) => account.id !== id))
  })
  ipcMain.handle('mail:list', (_event, accountId: string, folder: string) => listMail(accountById(accountId), folder))
  ipcMain.handle('mail:get', (_event, accountId: string, folder: string, uid: number) =>
    getMail(accountById(accountId), folder, uid))
  ipcMain.handle('mail:sent-folder', (_event, accountId: string) => getSentFolder(accountById(accountId)))
  ipcMain.handle('mail:send', (_event, draft: MailDraft) => sendMail(accountById(draft.accountId), draft))
  ipcMain.handle('ai:settings:get', () => {
    const { apiKey: _key, ...view } = store.ai
    return { ...view, hasApiKey: Boolean(store.ai.apiKey) }
  })
  ipcMain.handle('ai:settings:save', async (_event, input: AiSettingsInput) => {
    const settings = { ...input, apiKey: input.apiKey || store.ai.apiKey }
    validateAiSettings(settings)
    await store.setAi(settings)
  })
  ipcMain.handle('ai:settings:test', () => testAiConnection(store.ai))
  ipcMain.handle('ai:draft', (_event, instruction: string, accountId: string) => {
    accountById(accountId)
    return generateDraft(store.ai, instruction, accountId)
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
    const settings = store.ai
    if (!settings.autoDaily || !settings.apiKey || store.accounts.length === 0 || !window || window.isDestroyed()) return
    const now = new Date()
    const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const date = localDate()
    if (clock < settings.dailyTime || dailyAttempt === date) return
    dailyAttempt = date
    try {
      const digest = await digestFor(store.accounts.map((account) => account.id))
      window?.webContents.send('ai:digest:ready', digest)
    } catch {
      // Manual generation remains available if the scheduled run fails.
    }
  }, 60_000)
}

app.whenReady().then(async () => {
  try {
    store = new Store(app.getPath('userData'))
    await store.load()
    registerIpc()
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
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
