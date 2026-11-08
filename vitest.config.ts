/**
 * vitest.config.ts   (how `npm test` runs)
 *
 * Tests live in tests/ (mirroring src/). Two packages only work inside the real app, so tests get
 * stand-ins from tests/stubs/: "electron" (the desktop shell) and "ws" (WebSockets: no test may open a
 * real connection). `test.env` gives the code a fake Twitch client id, which the app normally reads
 * from .env at build time.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const stub = (name: string) => fileURLToPath(new URL(`./tests/stubs/${name}.ts`, import.meta.url))

export default defineConfig({
  resolve: { alias: { electron: stub('electron'), ws: stub('ws') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    env: { MAIN_VITE_TWITCH_CLIENT_ID: 'testclient' },
    testTimeout: 20_000
  }
})
