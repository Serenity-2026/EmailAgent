import { describe, expect, it } from 'vitest'
import { platformCommandPaths, windowsDockerDesktopPaths } from './local-service'

describe('platform Docker prerequisites', () => {
  it('finds Docker CLI and Desktop in standard Windows locations while preserving PATH', () => {
    const environment = {
      ProgramFiles: 'C:\\Apps', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
      Path: 'C:\\Tools;C:\\Windows\\System32'
    }
    expect(platformCommandPaths('win32', environment, 'C:\\Users\\tester')).toEqual([
      'C:\\Apps\\Docker\\Docker\\resources\\bin',
      'C:\\Users\\tester\\AppData\\Local\\Docker\\resources\\bin',
      'C:\\Tools', 'C:\\Windows\\System32'
    ])
    expect(windowsDockerDesktopPaths(environment)).toEqual([
      'C:\\Apps\\Docker\\Docker\\Docker Desktop.exe',
      'C:\\Users\\tester\\AppData\\Local\\Docker\\Docker Desktop.exe'
    ])
  })
})
