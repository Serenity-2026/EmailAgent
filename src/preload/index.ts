import { contextBridge, ipcRenderer } from 'electron'
import type { DigestFailure, DigestHistoryItem, DesktopApi } from '../shared/models'

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(/^Error invoking remote method '[^']+':\s*(?:[A-Za-z]*Error:\s*)?/, ''))
  }
}

const api: DesktopApi = {
  getBootstrapStatus: () => invoke('auth:bootstrap-status'),
  bootstrap: (username, password) => invoke('auth:bootstrap', username, password),
  getSession: () => invoke('auth:session'),
  login: (username, password) => invoke('auth:login', username, password),
  logout: () => invoke('auth:logout'),
  createUser: (username, password) => invoke('auth:create', username, password),
  changePassword: (currentPassword, nextPassword) => invoke('auth:password', currentPassword, nextPassword),
  listAccounts: () => invoke('accounts:list'),
  addAccount: (input) => invoke('accounts:add', input),
  removeAccount: (id) => invoke('accounts:remove', id),
  updateAccountAuthorizationCode: (id, authorizationCode) => invoke('accounts:update-authorization', id, authorizationCode),
  checkAccountHealth: (id) => invoke('accounts:health', id),
  listMailFolders: (accountId) => invoke('mail:folders', accountId),
  listMail: (accountId, folder, options) => invoke('mail:list', accountId, folder, options || {}),
  getMail: (accountId, folder, uid, markRead) => invoke('mail:get', accountId, folder, uid, markRead),
  openExternalLink: (url) => invoke('mail:open-link', url),
  getSentFolder: (accountId) => invoke('mail:sent-folder', accountId),
  sendMail: (draft) => invoke('mail:send', draft),
  getAiSettings: () => invoke('ai:settings:get'),
  listAiModels: (baseUrl, apiKey) => invoke('ai:models', baseUrl, apiKey),
  saveAiSettings: (input) => invoke('ai:settings:save', input),
  testAiConnection: () => invoke('ai:settings:test'),
  generateDraft: (instruction, accountId) => invoke('ai:draft', instruction, accountId),
  generateDigest: (accountIds) => invoke('ai:digest', accountIds),
  listDigestHistory: () => invoke('ai:digest:history'),
  onDailyDigest: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, digest: DigestHistoryItem): void => listener(digest)
    ipcRenderer.on('ai:digest:ready', handler)
    return () => ipcRenderer.removeListener('ai:digest:ready', handler)
  },
  onDailyDigestFailure: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, failure: DigestFailure): void => listener(failure)
    ipcRenderer.on('ai:digest:failed', handler)
    return () => ipcRenderer.removeListener('ai:digest:failed', handler)
  },
  listAgentConversations: () => invoke('agent:history'),
  runAgent: (prompt, conversationId, jobId) => invoke('agent:run', prompt, conversationId || '', jobId),
  cancelAgentJob: (jobId) => invoke('agent:cancel', jobId),
  confirmAgentProposal: (proposalId) => invoke('agent:confirm', proposalId),
  clearAgentHistory: () => invoke('agent:clear'),
  onAgentProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]): void => listener(progress)
    ipcRenderer.on('agent:progress', handler)
    return () => ipcRenderer.removeListener('agent:progress', handler)
  },
  onAppError: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: string): void => listener(message)
    ipcRenderer.on('app:error', handler)
    return () => ipcRenderer.removeListener('app:error', handler)
  },
  getAgentOverview: () => invoke('agent:overview'),
  getThemeMode: () => invoke('theme:get'),
  setThemeMode: (mode) => invoke('theme:set', mode)
}

contextBridge.exposeInMainWorld('emailAgent', api)
