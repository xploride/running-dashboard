import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const NATIVE_RUNS_KEY = 'running-dashboard.runs.v1'
const NATIVE_ROUTES_KEY = 'running-dashboard.routes.v3'
const LEGACY_ROUTE_SESSION_KEY = 'running-dashboard.routes.v2'
const API_ORIGIN = Capacitor.isNativePlatform() ? 'https://running-dashboard-two.vercel.app' : ''

function summaries(runs) {
  return runs.map(({ id, date, startedAt, distance, duration, pace, hr, calories, elevation, note, source }) => ({
    id, date, startedAt, distance, duration, pace, hr, calories, elevation, note, source,
  }))
}

async function request(path = '', options = {}) {
  const response = await fetch(`${API_ORIGIN}/api/runs${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `요청 실패 (HTTP ${response.status})`)
  return payload
}

export async function getRuns() {
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: NATIVE_RUNS_KEY })
    if (!value) return []
    try {
      const runs = JSON.parse(value)
      return Array.isArray(runs) ? runs : []
    } catch {
      return []
    }
  }
  const payload = await request()
  return Array.isArray(payload.runs) ? payload.runs : []
}

export async function putRuns(runs) {
  const cleanRuns = summaries(runs)
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: NATIVE_RUNS_KEY, value: JSON.stringify(cleanRuns) })
    return { ok: true, count: cleanRuns.length, storage: 'device' }
  }
  return request('', { method: 'PUT', body: JSON.stringify({ runs: cleanRuns }) })
}

function parseRoutes(value) {
  if (!value) return {}
  try {
    const routes = JSON.parse(value)
    return routes && typeof routes === 'object' && !Array.isArray(routes) ? routes : {}
  } catch {
    return {}
  }
}

function legacySessionRoutes() {
  try {
    return sessionStorage.getItem(LEGACY_ROUTE_SESSION_KEY)
  } catch {
    return null
  }
}

export async function getRoutes() {
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: NATIVE_ROUTES_KEY })
    if (value) return parseRoutes(value)

    const legacyValue = legacySessionRoutes()
    if (!legacyValue) return {}
    await Preferences.set({ key: NATIVE_ROUTES_KEY, value: legacyValue })
    return parseRoutes(legacyValue)
  }

  try {
    const value = localStorage.getItem(NATIVE_ROUTES_KEY) || legacySessionRoutes()
    if (value) localStorage.setItem(NATIVE_ROUTES_KEY, value)
    return parseRoutes(value)
  } catch {
    return parseRoutes(legacySessionRoutes())
  }
}

export async function putRoutes(routes) {
  const value = JSON.stringify(routes || {})
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: NATIVE_ROUTES_KEY, value })
    return { ok: true, storage: 'device' }
  }

  localStorage.setItem(NATIVE_ROUTES_KEY, value)
  return { ok: true, storage: 'browser' }
}

export async function askCoach(message, runs) {
  try {
    const response = await fetch(`${API_ORIGIN}/api/coach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, runs: runs.slice(-20) }),
    })
    if (!response.ok) return { answer: null }
    return response.json()
  } catch {
    return { answer: null }
  }
}
