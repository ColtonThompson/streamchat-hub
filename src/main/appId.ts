/**
 * main/appId.ts
 *
 * The app's Windows identity ("AppUserModelID"). Windows uses it to decide which app a desktop
 * notification belongs to; without one, notifications from an Electron app can silently never appear.
 * KEEP IT IDENTICAL to `appId` in electron-builder.yml (the installer registers the same id).
 * In development (`npm run dev`) there is no installer, so index.ts uses a separate dev id instead.
 */
export const APP_ID = 'com.example.streamchathub'
