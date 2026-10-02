import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { API_CHANNELS, validateRpc } from '../shared/api'
import { Database } from './database'
import { MysqlStore } from './store'
import { BackendContext } from './service'

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }

export function createBackendServer(db: Database): ReturnType<typeof createServer> {
  const contexts = new Map<string, BackendContext>()
  async function authenticate(token: string): Promise<BackendContext> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, '请先登录')
    const session = await db.session(token)
    if (!session) {
      contexts.get(token)?.invalidate(); contexts.delete(token)
      throw new HttpError(401, '登录状态已失效，请重新登录')
    }
    const cached = contexts.get(token)
    if (cached) { session.key.fill(0); cached.lastAccess = Date.now(); return cached }
    const context = new BackendContext(await MysqlStore.restore(db, session.username, session.key), token)
    contexts.set(token, context)
    return context
  }
  const send = (response: ServerResponse, status: number, body: unknown): void => {
    if (response.destroyed || response.writableEnded) return
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(JSON.stringify(body))
  }
  async function bodyOf(request: IncomingMessage): Promise<unknown[]> {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, '请使用 JSON 请求')
    let bytes = 0
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      bytes += chunk.length
      if (bytes > 2_000_000) throw new HttpError(413, '请求内容过大')
      chunks.push(chunk)
    }
    let body: { args?: unknown }
    try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { throw new HttpError(400, '请求参数无效') }
    if (!body || !Array.isArray(body.args)) throw new HttpError(400, '请求参数无效')
    return body.args
  }

  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.origin) throw new HttpError(403, '请求来源无效')
      const path = new URL(request.url || '/', 'http://localhost').pathname
      if (request.method === 'GET' && path === '/health') {
        await db.pool.execute('SELECT 1')
        send(response, 200, { status: 'ok', database: 'mysql' }); return
      }
      const token = request.headers.authorization?.replace(/^Bearer /, '') || ''
      if (request.method === 'GET' && path === '/api/events') {
        const context = await authenticate(token)
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
        response.write(': connected\n\n')
        const listener = (channel: string, payload: unknown): void => { response.write(`data: ${JSON.stringify({ channel, payload })}\n\n`) }
        context.listeners.add(listener)
        const heartbeat = setInterval(() => { response.write(': heartbeat\n\n') }, 15_000)
        response.on('close', () => { clearInterval(heartbeat); context.listeners.delete(listener) })
        return
      }
      if (request.method !== 'POST' || !path.startsWith('/api/rpc/')) throw new HttpError(404, '接口不存在')
      const channel = decodeURIComponent(path.slice('/api/rpc/'.length))
      if (!(API_CHANNELS as readonly string[]).includes(channel)) throw new HttpError(404, '接口不存在')
      const args = await bodyOf(request)
      validateRpc(channel, args)
      if (channel === 'auth:login') {
        if (token) { await db.revoke(token); contexts.get(token)?.invalidate(false); contexts.delete(token) }
        const store = await MysqlStore.login(db, args[0] as string, args[1] as string)
        const nextToken = await store.createSession()
        contexts.set(nextToken, new BackendContext(store, nextToken))
        send(response, 200, { result: { username: store.username, token: nextToken } }); return
      }
      if (channel === 'auth:session' && !token) { send(response, 200, { result: { username: null } }); return }
      const context = await authenticate(token)
      if (channel === 'auth:session') {
        send(response, 200, { result: { username: context.store.username } }); return
      }
      if (channel === 'auth:logout') {
        await db.revoke(token); context.invalidate(false); contexts.delete(token)
        send(response, 200, { result: null }); return
      }
      const result = await context.invoke(channel, args)
      if (channel === 'auth:password') {
        for (const [id, other] of contexts) {
          if (other.store.username === context.store.username && id !== token) { other.invalidate(); contexts.delete(id) }
        }
      }
      send(response, 200, { result: result ?? null })
    })().catch((error: unknown) => {
      const code = (error as { code?: string })?.code
      const databaseError = code && /^(ER_|ECONN|ETIMEDOUT|PROTOCOL_)/.test(code)
      const status = error instanceof HttpError ? error.status : databaseError ? 503 : 400
      send(response, status, { error: databaseError ? '数据库服务不可用，请稍后重试' : error instanceof Error && !(error instanceof TypeError) ? error.message : '请求处理失败' })
    })
  })
  server.requestTimeout = 180_000
  const schedule = setInterval(() => {
    for (const [token, context] of contexts) {
      if (!context.listeners.size) {
        if (Date.now() - context.lastAccess > 10 * 60_000) { context.invalidate(false); contexts.delete(token) }
        continue
      }
      void (async () => {
        const session = await db.session(token)
        if (!session) { context.invalidate(); contexts.delete(token); return }
        session.key.fill(0)
        const settings = context.store.ai
        const now = new Date()
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        if (!settings.autoDaily || !settings.apiKey || !context.store.accounts.length || clock < settings.dailyTime || context.dailyAttempt === date) return
        context.dailyAttempt = date
        const digest = await context.invoke('ai:digest', [context.store.accounts.map((account) => account.id)])
        if (context.store.activeUsername) context.emit('ai:digest:ready', digest)
      })().catch(() => context.emit('app:error', '每日摘要生成失败，可稍后手动重试'))
    }
  }, 60_000)
  server.on('close', () => { clearInterval(schedule); for (const context of contexts.values()) context.invalidate(false); contexts.clear() })
  return server
}
