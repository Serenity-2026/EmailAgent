import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const REDACTED = '[REDACTED]'
const SENSITIVE_KEY = /authorization|password|passcode|api.?key|token|secret|credential|body|text|html|content|source|base64|ciphertext|draft|mail/i

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, `$1${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b[a-f0-9]{64}\b/gi, REDACTED)
    .replace(/("(?:authorizationCode|apiKey|password|token|secret|body|text|html|content|base64)"\s*:\s*")[^"]*(")/gi,
      `$1${REDACTED}$2`)
}

export function redactDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED
  if (depth > 6) return '[TRUNCATED]'
  if (typeof value === 'string') return redactDiagnosticText(value).slice(0, 2000)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactDiagnosticValue(item, '', depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 50)
      .map(([name, item]) => [name, redactDiagnosticValue(item, name, depth + 1)]))
  }
  return String(value)
}

export class DiagnosticsLogger {
  private tail: Promise<void> = Promise.resolve()
  constructor(private readonly directory: string, private readonly maxBytes = 512_000,
    private readonly fileCount = 3) {}

  private path(index = 0): string {
    return join(this.directory, index === 0 ? 'emailagent.log' : `emailagent.log.${index}`)
  }

  record(level: 'info' | 'warn' | 'error', event: string, details: Record<string, unknown> = {}): Promise<void> {
    const line = `${JSON.stringify({
      timestamp: new Date().toISOString(), level, event: redactDiagnosticText(event).slice(0, 120),
      details: redactDiagnosticValue(details)
    })}\n`
    const operation = this.tail.then(async () => {
      await mkdir(this.directory, { recursive: true })
      let size = 0
      try { size = (await stat(this.path())).size } catch { /* First diagnostic line. */ }
      if (size > 0 && size + Buffer.byteLength(line) > this.maxBytes) await this.rotate()
      await appendFile(this.path(), line, { encoding: 'utf8', mode: 0o600 })
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }

  private async rotate(): Promise<void> {
    await rm(this.path(this.fileCount - 1), { force: true })
    for (let index = this.fileCount - 2; index >= 0; index--) {
      try { await rename(this.path(index), this.path(index + 1)) } catch { /* Missing generation. */ }
    }
  }

  async exportTo(target: string, metadata: Record<string, unknown>): Promise<void> {
    await this.tail
    const sections: string[] = [JSON.stringify({
      exportedAt: new Date().toISOString(), metadata: redactDiagnosticValue(metadata)
    })]
    for (let index = this.fileCount - 1; index >= 0; index--) {
      try { sections.push(await readFile(this.path(index), 'utf8')) } catch { /* Missing generation. */ }
    }
    await writeFile(target, redactDiagnosticText(`${sections.join('\n')}\n`), { encoding: 'utf8', mode: 0o600 })
  }
}
