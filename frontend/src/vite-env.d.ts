/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL: string
  readonly VITE_CHAIN_ID: string
  readonly VITE_API_URL: string
  readonly VITE_FACTORY_ADDRESS: string
  readonly VITE_OBLIGATION_REGISTRY_ADDRESS: string
  readonly VITE_DISPUTE_MANAGER_ADDRESS: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}