/**
 * electron.vite.config.ts   (build configuration)
 *
 * WHAT: Tells electron-vite how to build the app's three parts (main, preload, renderer). The
 * defaults are used for everything, which expects:
 *     src/main/index.ts           the main process entry
 *     src/preload/index.ts        the preload script
 *     src/renderer/index.html     the UI entry
 * So there is very little to configure.
 *
 * `externalizeDepsPlugin()` keeps npm packages (ws, electron...) out of the bundled main/preload code;
 * they're loaded from node_modules at runtime instead.
 * `react()` enables React (JSX) support in the UI build.
 *
 * ENVIRONMENT VARIABLES: electron-vite reads `.env` automatically. Only names beginning with
 * MAIN_VITE_ (main process), PRELOAD_VITE_ or RENDERER_VITE_ are exposed, so unrelated secrets
 * in `.env` can't leak into the app.
 *
 * COMMANDS: `npm run dev` (live-reload development), `npm run build` (production bundle).
 */
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
