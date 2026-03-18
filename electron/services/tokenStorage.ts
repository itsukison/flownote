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

const setupStore = new Store<{ completed: boolean; completedByUser?: Record<string, boolean> }>({
  name: 'setup-store',
})

function getPerUserFlag(store: Store<{ completed: boolean; completedByUser?: Record<string, boolean> }>, userId?: string): boolean {
  if (userId) {
    const map = store.get('completedByUser', {})
    return Boolean(map?.[userId])
  }
  return store.get('completed', false)
}

function setPerUserFlag(store: Store<{ completed: boolean; completedByUser?: Record<string, boolean> }>, userId?: string): void {
  if (userId) {
    const map = store.get('completedByUser', {})
    store.set('completedByUser', { ...map, [userId]: true })
    return
  }
  store.set('completed', true)
}

export function getSetupCompleted(userId?: string): boolean {
  return getPerUserFlag(setupStore, userId)
}

export function setSetupCompleted(userId?: string): void {
  setPerUserFlag(setupStore, userId)
}

const tutorialStore = new Store<{ completed: boolean; completedByUser?: Record<string, boolean> }>({
  name: 'tutorial-store',
})

export function getTutorialCompleted(userId?: string): boolean {
  return getPerUserFlag(tutorialStore, userId)
}

export function setTutorialCompleted(userId?: string): void {
  setPerUserFlag(tutorialStore, userId)
}

const onboardingStore = new Store<{ completed: boolean; completedByUser?: Record<string, boolean> }>({
  name: 'onboarding-store',
})

export function getOnboardingCompleted(userId?: string): boolean {
  const local = getPerUserFlag(onboardingStore, userId)
  if (local) return true

  // Local migration: if older flags were set, treat onboarding as completed.
  const legacyCompleted = getPerUserFlag(setupStore, userId) || getPerUserFlag(tutorialStore, userId)
  if (legacyCompleted) {
    setPerUserFlag(onboardingStore, userId)
    return true
  }

  return false
}

export function setOnboardingCompleted(userId?: string): void {
  setPerUserFlag(onboardingStore, userId)
}
