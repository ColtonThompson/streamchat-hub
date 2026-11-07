/**
 * main/env.d.ts
 *
 * WHAT: Tells TypeScript about `import.meta.env` in the main process.
 *
 * HOW IT WORKS: electron-vite reads variables from the `.env` file and exposes those starting with
 *   `MAIN_VITE_` to main-process code as `import.meta.env.MAIN_VITE_*`. This file only declares their
 *   types; the values come from `.env` (see `.env.example`).
 *
 * CHANGE IT WHEN: you add another `MAIN_VITE_...` variable to `.env`.
 */
/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  /** Client ID of your app from https://dev.twitch.tv/console (needed for Twitch sign-in). */
  readonly MAIN_VITE_TWITCH_CLIENT_ID?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
