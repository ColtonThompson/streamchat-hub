/**
 * scripts/ensure-electron.mjs   (makes sure the Electron program itself is downloaded)
 *
 * WHY: the "electron" npm package is only a downloader. The real electron.exe is fetched by a script that npm runs
 * AFTER installing it. When npm skips that script (newer npm versions only run dependency install scripts that are
 * approved, and `ignore-scripts` turns them all off), the app fails to start with "Error: Electron uninstall".
 *
 * WHAT: if the download is missing, run Electron's own installer. It does nothing when Electron is already there, and
 * on CI (where only the tests run) it does nothing at all. package.json runs it after `npm install` / `npm ci`
 * ("postinstall") and before `npm run dev` ("predev"), so it fixes itself without any extra step.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.CI) process.exit(0)

const pkg = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'electron')
const installer = path.join(pkg, 'install.js')
const downloaded = existsSync(path.join(pkg, 'path.txt')) && existsSync(path.join(pkg, 'dist'))

if (!existsSync(installer) || downloaded) process.exit(0) // not installed at all (nothing to do), or already complete

console.log('Electron is not downloaded yet: downloading it now...')
const result = spawnSync(process.execPath, [installer], { stdio: 'inherit' })
process.exit(result.status ?? 1)
