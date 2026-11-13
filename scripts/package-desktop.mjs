import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const target = process.argv[2]
if (!['mac', 'win'].includes(target)) throw new Error('Usage: node scripts/package-desktop.mjs <mac|win>')
if ((target === 'mac' && process.platform !== 'darwin') || (target === 'win' && process.platform !== 'win32')) {
  throw new Error(`Cannot package a ${target} application on ${process.platform}`)
}

const electronDist = resolve('node_modules', 'electron', 'dist')
const electronRuntime = target === 'win'
  ? resolve(electronDist, 'electron.exe')
  : resolve(electronDist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
const builderCli = resolve('node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const args = [builderCli, `--${target}`, 'dir', '--publish', 'never']
if (target === 'win') args.push('--x64')
if (existsSync(electronRuntime)) {
  args.push(`--config.electronDist=${electronDist}`)
  console.log(`Packaging with installed Electron runtime: ${electronDist}`)
} else {
  console.log('Installed Electron runtime is absent; electron-builder will download the locked runtime.')
}

const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })
child.once('error', (error) => { throw error })
child.once('exit', (code, signal) => {
  if (signal) throw new Error(`electron-builder was terminated by ${signal}`)
  process.exitCode = code ?? 1
})
