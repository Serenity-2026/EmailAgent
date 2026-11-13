import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DiagnosticsLogger, redactDiagnosticText, redactDiagnosticValue } from './diagnostics'

const directories: string[] = []
afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))))

describe('redacted rotating diagnostics', () => {
  it('redacts credentials, tokens and mail content recursively', () => {
    const token = 'a'.repeat(64)
    const result = JSON.stringify(redactDiagnosticValue({
      authorizationCode: 'mail-code', apiKey: 'sk-private-key', nested: { token, body: 'private mail body' },
      safe: `request failed with Bearer ${token}`
    }))
    for (const secret of ['mail-code', 'sk-private-key', token, 'private mail body']) expect(result).not.toContain(secret)
    expect(redactDiagnosticText(`token=${token}`)).not.toContain(token)
  })

  it('rotates bounded files and re-redacts the exported bundle', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emailagent-diagnostics-'))
    directories.push(directory)
    const logger = new DiagnosticsLogger(directory, 220, 3)
    for (let index = 0; index < 12; index++) {
      await logger.record('info', `event-${index}`, { channel: 'mail:list', durationMs: index,
        password: 'never-export', note: `Bearer ${'b'.repeat(64)}` })
    }
    const target = join(directory, 'export.txt')
    await logger.exportTo(target, { version: 'test', apiKey: 'never-export-key' })
    const exported = await readFile(target, 'utf8')
    expect(exported).toContain('event-11')
    expect(exported).toContain('[REDACTED]')
    expect(exported).not.toContain('never-export')
    expect(exported).not.toContain('b'.repeat(64))
    expect(await readFile(join(directory, 'emailagent.log.1'), 'utf8')).toBeTruthy()
  })
})
