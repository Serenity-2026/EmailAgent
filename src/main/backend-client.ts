import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import { API_CHANNELS } from '../shared/api'

export class BackendClient {
  private token = ''
  private events: AbortController | null = null
  private reconnect: ReturnType<typeof setTimeout> | null = null
  private readonly path: string
  private readonly baseUrl: string
  constructor(directory: string, private readonly emit: (channel: string, payload: unknown) => void,
    baseUrl = process.env.EMAILAGENT_API_URL || 'http://127.0.0.1:3210') {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error('后端地址必须使用 HTTPS 或本机地址')
    }
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.path = join(directory, 'emailagent.api-session')
  }

  async restoreToken(): Promise<void> {
    try {
      if (!safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return
      const token = safeStorage.decryptString(await readFile(this.path))
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('登录状态无效')
      this.token = token
    } catch { await rm(this.path, { force: true }).catch(() => undefined) }
  }

  private async saveToken(): Promise<void> {
    if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, safeStorage.encryptString(this.token), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    } finally { await rm(temporary, { force: true }) }
  }

  private async clearToken(): Promise<void> {
    this.token = ''
    this.stopEvents()
    await rm(this.path, { force: true }).catch(() => undefined)
  }

  async request<T = unknown>(channel: string, args: unknown[] = []): Promise<T> {
    if (!(API_CHANNELS as readonly string[]).includes(channel)) throw new Error('接口不存在')
    const parameters = [...args]
    while (parameters.length && parameters[parameters.length - 1] === undefined) parameters.pop()
    const token = this.token
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/rpc/${encodeURIComponent(channel)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ args: parameters }), signal: AbortSignal.timeout(180_000)
      })
    } catch (error) {
      if (channel === 'auth:logout') { await this.clearToken(); return null as T }
      throw new Error(error instanceof Error && error.name === 'TimeoutError' ? '后端请求超时，请稍后重试' : '无法连接后端服务，请启动 Docker 中的 EmailAgent 服务后重试')
    }
    const body = await response.json() as { result?: any; error?: string }
    if (!response.ok) {
      if (channel === 'auth:logout') { await this.clearToken(); return null as T }
      if (response.status === 401 && token === this.token) {
        await this.clearToken()
        if (channel === 'auth:session') return { username: null } as T
        this.emit('auth:expired', null)
      }
      throw new Error(body.error || '后端请求失败')
    }
    if (token !== this.token) throw new Error('登录状态已变化，请重试')
    if (channel === 'auth:login' || channel === 'auth:bootstrap') {
      if (!/^[a-f0-9]{64}$/.test(body.result?.token)) throw new Error('后端登录响应无效')
      this.stopEvents(); this.token = body.result.token
      await this.saveToken().catch(() => this.emit('app:error', '登录成功，但登录状态未能保存，下次启动需重新登录'))
      this.startEvents()
      return { username: body.result.username } as T
    }
    if (channel === 'auth:logout') await this.clearToken()
    return body.result as T
  }

  stopEvents(): void {
    this.events?.abort(); this.events = null
    if (this.reconnect) clearTimeout(this.reconnect)
    this.reconnect = null
  }

  startEvents(): void {
    if (!this.token || this.events) return
    const controller = new AbortController()
    this.events = controller
    const token = this.token
    void (async () => {
      const response = await fetch(`${this.baseUrl}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      if (response.status === 401) { await this.clearToken(); this.emit('auth:expired', null); return }
      if (!response.ok || !response.body) throw new Error('事件连接失败')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
          const data = block.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
          if (!data) continue
          const event = JSON.parse(data) as { channel: string; payload: unknown }
          if (token !== this.token) return
          if (event.channel === 'auth:expired') await this.clearToken()
          if (['auth:expired', 'app:error', 'agent:progress', 'ai:digest:ready'].includes(event.channel)) this.emit(event.channel, event.payload)
        }
      }
    })().catch(() => undefined).finally(() => {
      if (this.events !== controller) return
      this.events = null
      if (this.token && !controller.signal.aborted) this.reconnect = setTimeout(() => { this.reconnect = null; this.startEvents() }, 2000)
    })
  }
}
