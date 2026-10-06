import { Capacitor } from '@capacitor/core'
import { HealthKit } from '@running/healthkit'

export const isNativeHealthAvailable = () => Capacitor.getPlatform() === 'ios'

export async function authorizeHealthKit() {
  if (!isNativeHealthAvailable()) return { authorized: false }
  const availability = await HealthKit.isAvailable()
  if (!availability.available) throw new Error('이 기기에서는 Apple 건강을 사용할 수 없습니다.')
  return HealthKit.requestAuthorization()
}

export async function readHealthKitRuns(days = 365) {
  if (!isNativeHealthAvailable()) throw new Error('Apple 건강 동기화는 iOS 앱에서만 사용할 수 있습니다.')
  const result = await HealthKit.readRuns({ days, includeRoutes: true })
  return Array.isArray(result.runs) ? result.runs : []
}

export async function saveRunToHealth(run, coords = []) {
  if (!isNativeHealthAvailable()) throw new Error('Apple 건강 저장은 iOS 앱에서만 사용할 수 있습니다.')
  const routeStart = coords.find((point) => point.time)?.time
  const candidate = new Date(run.startedAt || routeStart || `${run.date}T07:00:00`)
  const start = Number.isNaN(candidate.getTime()) ? new Date().toISOString() : candidate.toISOString()
  return HealthKit.saveRun({
    externalId: run.id,
    date: start,
    distance: run.distance,
    duration: run.duration,
    calories: run.calories,
    hr: run.hr,
    coords,
  })
}
