import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const target = process.argv[2]
if (!['mac', 'win'].includes(target)) throw new Error('Usage: node scripts/verify-packaged-startup.mjs <mac|win>')
if ((target === 'mac' && process.platform !== 'darwin') || (target === 'win' && process.platform !== 'win32')) {
  throw new Error(`Cannot start a ${target} package on ${process.platform}`)
}

const candidates = target === 'win'
  ? [join('release', 'win-unpacked', 'EmailAgent.exe')]
  : ['mac', 'mac-arm64', 'mac-x64'].map((directory) =>
      join('release', directory, 'EmailAgent.app', 'Contents', 'MacOS', 'EmailAgent'))

let executable = ''
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break } catch { /* Try another builder output directory. */ }
}
if (!executable) throw new Error(`Packaged executable not found. Checked: ${candidates.join(', ')}`)

const temporary = await mkdtemp(join(tmpdir(), 'emailagent-startup-'))
const userData = join(temporary, 'user-data')
const marker = join(temporary, 'ready.json')
const childEnvironment = { ...process.env }
delete childEnvironment.ELECTRON_RUN_AS_NODE

try {
  const child = spawn(executable, [`--user-data-dir=${userData}`], {
    env: {
      ...childEnvironment,
      EMAILAGENT_API_URL: 'http://127.0.0.1:9',
      EMAILAGENT_STARTUP_SMOKE: '1',
      EMAILAGENT_STARTUP_SMOKE_RESULT: marker
    },
    stdio: 'ignore',
    windowsHide: true
  })
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged application startup timed out')) }, 30_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); signal ? reject(new Error(`Application exited by ${signal}`)) : resolve(code) })
  })
  if (exitCode !== 0) throw new Error(`Packaged application exited with code ${exitCode}`)
  const result = JSON.parse(await readFile(marker, 'utf8'))
  const expectedPlatform = target === 'win' ? 'win32' : 'darwin'
  if (result.status !== 'ready' || result.packaged !== true || result.platform !== expectedPlatform) {
    throw new Error(`Invalid startup marker: ${JSON.stringify(result)}`)
  }
  console.log(`Packaged ${target} application loaded its renderer successfully (${result.arch}).`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
