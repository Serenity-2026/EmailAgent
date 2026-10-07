import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const target = 'out/service'
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
for (const name of ['compose.yml', 'Dockerfile.runtime', 'package.json', 'package-lock.json']) {
  await cp(name, join(target, name))
}
await cp('out/backend', join(target, 'out/backend'), { recursive: true })
