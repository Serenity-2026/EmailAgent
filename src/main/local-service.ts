import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const execute = promisify(execFile)
const commandPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/Applications/Docker.app/Contents/Resources/bin',
  join(homedir(), '.docker/bin'), '/usr/bin', '/bin', ...(process.env.PATH || '').split(':').filter(Boolean)]
const commandEnv = { ...process.env, PATH: `${commandPaths.join(':')}:${process.env.PATH || ''}` }

async function command(name: string, args: string[], timeout = 30_000, extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await execute(name, args, { timeout, maxBuffer: 1024 * 1024, env: { ...commandEnv, ...extraEnv } })
  return stdout.trim()
}

async function available(name: string): Promise<boolean> {
  for (const directory of commandPaths) {
    try { await access(join(directory, name)); return true } catch { /* Try another location. */ }
  }
  return false
}

async function healthy(): Promise<boolean> {
  try {
    const response = await fetch('http://127.0.0.1:3210/health', { signal: AbortSignal.timeout(2500) })
    return response.ok
  } catch { return false }
}

async function waitFor(check: () => Promise<boolean>, timeout: number): Promise<boolean> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return false
}

function environment(lines: string[]): Record<string, string> {
  return Object.fromEntries(lines.map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))
}

export class LocalService {
  private starting: Promise<void> | null = null
  constructor(private readonly dataDirectory: string, private readonly serviceDirectory: string,
    private readonly packaged: boolean) {}

  async ready(): Promise<void> {
    if (await healthy()) return
    if (!this.starting) this.starting = this.start().finally(() => { this.starting = null })
    await this.starting
  }

  private async existingEnvironment(service: string): Promise<Record<string, string> | null> {
    const id = await command('docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=emailagent',
      '--filter', `label=com.docker.compose.service=${service}`])
    if (!id) return null
    const raw = await command('docker', ['inspect', '--format', '{{json .Config.Env}}', id.split('\n')[0]])
    return environment(JSON.parse(raw) as string[])
  }

  private async config(): Promise<string> {
    const path = join(this.dataDirectory, 'service.env')
    try { await readFile(path); return path } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const backend = await this.existingEnvironment('backend')
    const mysql = await this.existingEnvironment('mysql')
    const existingVolume = await command('docker', ['volume', 'ls', '-q', '--filter', 'name=^emailagent_mysql-data$'])
    if (existingVolume && (!backend?.MYSQL_PASSWORD || !backend.SESSION_KEY)) {
      throw new Error('已有 MySQL 数据，但无法恢复连接配置；请保留原数据库并联系开发者处理')
    }
    const values = {
      MYSQL_ROOT_PASSWORD: mysql?.MYSQL_ROOT_PASSWORD || 'dmc162272',
      MYSQL_PASSWORD: backend?.MYSQL_PASSWORD || randomBytes(24).toString('hex'),
      SESSION_KEY: backend?.SESSION_KEY || randomBytes(32).toString('base64')
    }
    await writeFile(path, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''), { mode: 0o600, flag: 'wx' })
    return path
  }

  private async start(): Promise<void> {
    if (!await available('docker')) throw new Error('未检测到 Docker，请安装并打开 Docker 后重新连接')
    const dockerReady = async (): Promise<boolean> => {
      try { await command('docker', ['info', '--format', '{{.ServerVersion}}'], 5000); return true } catch { return false }
    }
    if (!await dockerReady()) {
      if (await available('colima')) {
        try { await command('colima', ['start'], 180_000) } catch { /* Verify Docker directly below. */ }
      } else {
        try { await command('/usr/bin/open', ['-a', 'Docker'], 10_000) } catch { /* Verify Docker directly below. */ }
      }
      if (!await waitFor(dockerReady, 90_000)) throw new Error('Docker 未能启动，请检查 Docker 后重新连接')
    }
    const envFile = await this.config()
    const compose = ['compose', '--env-file', envFile, '-f', join(this.serviceDirectory, 'compose.yml')]
    const environment = { BACKEND_DOCKERFILE: this.packaged ? 'Dockerfile.runtime' : 'Dockerfile.backend' }
    try {
      await command('docker', [...compose, 'up', '-d', '--build', '--wait'], 300_000, environment)
    } catch {
      if (!await healthy()) throw new Error('邮件服务启动失败，请检查 Docker 后重新连接')
    }
    if (!await waitFor(healthy, 15_000)) throw new Error('数据库尚未就绪，请稍后重新连接')
  }
}
