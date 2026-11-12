import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { API_CHANNELS } from '../shared/api'
import { BackendClient } from './backend-client'
import { DiagnosticsLogger } from './diagnostics'
import { LocalService } from './local-service'
import type { AttachmentDownload, AttachmentSaveResult, DiagnosticExportResult, ThemeMode } from '../shared/models'
import { MAX_ATTACHMENT_BYTES, sanitizeAttachmentFilename } from '../shared/attachments'

let window: BrowserWindow | null = null
let client: BackendClient
let localService: LocalService | null = null
let diagnostics: DiagnosticsLogger | undefined
let composeDirty = false
let closePromptOpen = false
let forceWindowClose = false
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()

function emit(channel: string, payload: unknown): void {
  if (channel === 'app:error') void diagnostics?.record('warn', 'app.error-presented')
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
  if (channel === 'auth:expired') { nativeTheme.themeSource = 'system'; window.webContents.reload(); return }
  try { window.webContents.send(channel, payload) } catch { /* Renderer has closed. */ }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240, height: 800, minWidth: 900, minHeight: 600, title: 'EmailAgent',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('close', (event) => {
    if (!composeDirty || forceWindowClose) return
    event.preventDefault()
    if (closePromptOpen || !window) return
    closePromptOpen = true
    void dialog.showMessageBox(window, {
      type: 'warning', title: '有未保存的邮件', message: '当前邮件尚未保存为草稿。',
      detail: '直接关闭会丢失这些修改。', buttons: ['继续编辑', '放弃修改并关闭'],
      defaultId: 0, cancelId: 0, noLink: true
    }).then(({ response }) => {
      closePromptOpen = false
      if (response !== 1 || !window) return
      composeDirty = false
      forceWindowClose = true
      window.close()
    })
  })
  window.on('closed', () => {
    client.stopEvents(); window = null; composeDirty = false; closePromptOpen = false; forceWindowClose = false
  })
  const load = process.env.ELECTRON_RENDERER_URL ? window.loadURL(process.env.ELECTRON_RENDERER_URL) : window.loadFile(join(__dirname, '../renderer/index.html'))
  void load.catch(() => { void diagnostics?.record('error', 'window.load-failed'); emit('app:error', '界面加载失败，请重新启动应用') })
  client.startEvents()
}

function registerIpc(): void {
  for (const channel of API_CHANNELS) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (event.senderFrame !== window?.webContents.mainFrame) throw new Error('请求来源无效')
      const started = Date.now()
      try {
        if (channel !== 'auth:logout') await localService?.ready()
        const result = await client.request(channel, args)
        if (channel === 'theme:set') nativeTheme.themeSource = args[0] as ThemeMode
        if (channel === 'theme:get') nativeTheme.themeSource = result as ThemeMode
        if (channel === 'auth:logout') nativeTheme.themeSource = 'system'
        void diagnostics?.record('info', 'rpc.completed', { channel, durationMs: Date.now() - started })
        return result
      } catch (error) {
        void diagnostics?.record('warn', 'rpc.failed', {
          channel, durationMs: Date.now() - started,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown'
        })
        throw error
      }
    })
  }
  ipcMain.handle('mail:open-link', async (event, value: string) => {
    if (event.senderFrame !== window?.webContents.mainFrame || typeof value !== 'string') throw new Error('链接无效')
    await localService?.ready()
    const session = await client.request<{ username: string | null }>('auth:session')
    if (!session.username) throw new Error('请先登录')
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('仅支持打开 HTTPS 链接')
    await shell.openExternal(url.toString())
  })
  ipcMain.handle('app:compose-dirty', (event, value: boolean) => {
    if (event.senderFrame !== window?.webContents.mainFrame || typeof value !== 'boolean') throw new Error('草稿状态无效')
    composeDirty = value
  })
  ipcMain.handle('mail:save-attachment', async (event, accountId: string, folder: string, uid: number,
    uidValidity: string, attachmentId: string, suggestedName: string): Promise<AttachmentSaveResult> => {
    if (event.senderFrame !== window?.webContents.mainFrame || !window ||
      ![accountId, folder, uidValidity, attachmentId, suggestedName].every((value) => typeof value === 'string') ||
      !Number.isSafeInteger(uid) || uid < 1) throw new Error('附件请求无效')
    const selection = await dialog.showSaveDialog(window, {
      title: '保存附件', defaultPath: sanitizeAttachmentFilename(suggestedName),
      buttonLabel: '保存', properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (selection.canceled || !selection.filePath) return { saved: false }
    await localService?.ready()
    const attachment = await client.request<AttachmentDownload>('mail:attachment', [
      accountId, folder, uid, uidValidity, attachmentId
    ])
    const content = Buffer.from(attachment.base64, 'base64')
    if (attachment.size !== content.length || content.length > MAX_ATTACHMENT_BYTES) {
      throw new Error('附件大小校验失败，未保存文件')
    }
    await writeFile(selection.filePath, content)
    void diagnostics?.record('info', 'attachment.saved', { size: content.length })
    return { saved: true, fileName: basename(selection.filePath) }
  })
  ipcMain.handle('diagnostics:export', async (event): Promise<DiagnosticExportResult> => {
    if (event.senderFrame !== window?.webContents.mainFrame || !window || !diagnostics) throw new Error('诊断导出不可用')
    const date = new Date().toISOString().slice(0, 10)
    const selection = await dialog.showSaveDialog(window, {
      title: '导出诊断信息', defaultPath: `emailagent-diagnostics-${date}.txt`,
      buttonLabel: '导出', properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (selection.canceled || !selection.filePath) return { saved: false }
    await diagnostics.record('info', 'diagnostics.export-requested')
    await diagnostics.exportTo(selection.filePath, {
      appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
      electronVersion: process.versions.electron, nodeVersion: process.versions.node,
      packaged: app.isPackaged
    })
    return { saved: true, fileName: basename(selection.filePath) }
  })
}

process.on('uncaughtException', () => { void diagnostics?.record('error', 'process.uncaught-exception'); emit('app:error', '应用遇到意外错误，请重新启动应用') })
process.on('unhandledRejection', () => { void diagnostics?.record('error', 'process.unhandled-rejection'); emit('app:error', '应用请求失败，请稍后重试') })
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.focus() } })
if (ownsInstance) void app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  diagnostics = new DiagnosticsLogger(join(userData, 'diagnostics'))
  await diagnostics.record('info', 'app.ready', {
    appVersion: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged
  })
  client = new BackendClient(userData, emit)
  if (!process.env.EMAILAGENT_API_URL) {
    localService = new LocalService(app.getPath('userData'), app.isPackaged ? join(process.resourcesPath, 'service') : process.cwd(), app.isPackaged)
  }
  await client.restoreToken()
  registerIpc()
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (ownsInstance && client && BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', () => client?.stopEvents())
