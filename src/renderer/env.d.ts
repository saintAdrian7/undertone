/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WHISPER_MODEL?: string
  readonly VITE_VAD_ASSETS_URL?: string
  readonly VITE_ORT_WASM_URL?: string
  readonly VITE_TRANSFORMERS_ORT_WASM_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
