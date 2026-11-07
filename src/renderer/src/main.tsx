/**
 * renderer/src/main.tsx   (the UI's entry point)
 *
 * WHAT: Loads the font and the stylesheet, applies the saved theme, then mounts the React app into the page.
 * (The theme is applied BEFORE the first draw so a light-theme user never sees a dark flash.)
 * The real UI starts at App.tsx.
 */
import '@fontsource-variable/figtree' // bundles the Figtree font so the app works offline
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './store/themeSync'
import './styles.css'

initTheme()

createRoot(document.getElementById('root')!).render(
  // StrictMode runs components twice in development to surface bugs; it does nothing in production.
  <StrictMode>
    <App />
  </StrictMode>
)
