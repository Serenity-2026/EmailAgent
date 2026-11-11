import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const nodeArguments = [
  ...(existsSync('.env') ? ['--env-file=.env'] : []),
  'node_modules/vitest/vitest.mjs',
  'run',
  'src/backend/database.integration.test.ts'
]

const child = spawn(process.execPath, nodeArguments, {
  stdio: 'inherit',
  env: { ...process.env, EMAILAGENT_MYSQL_TEST: '1' }
})

child.on('error', (error) => {
  process.stderr.write(`无法启动后端集成测试：${error.message}\n`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) process.stderr.write(`后端集成测试被信号 ${signal} 中止\n`)
  process.exitCode = code ?? 1
})
