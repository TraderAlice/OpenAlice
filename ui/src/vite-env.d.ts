/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEMO_MODE?: string
  readonly VITE_SHOW_DEMO_BANNER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
