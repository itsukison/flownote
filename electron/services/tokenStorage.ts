import Store from 'electron-store'

interface SessionData {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
}

interface TokenStoreSchema {
  session: SessionData | null
}

const store = new Store<TokenStoreSchema>({
  name: 'auth-session',
  encryptionKey: 'cue-me-secure-key-v1',
})

export function saveSession(session: SessionData): void {
  store.set('session', session)
}

export function getStoredSession(): SessionData | null {
  return store.get('session', null)
}

export function clearSession(): void {
  store.delete('session')
}

export function hasStoredSession(): boolean {
  return store.has('session')
}

const setupStore = new Store<{ completed: boolean }>({
  name: 'setup-store',
})

export function getSetupCompleted(): boolean {
  return setupStore.get('completed', false)
}

export function setSetupCompleted(): void {
  setupStore.set('completed', true)
}
