import { Capacitor } from '@capacitor/core'
import { HealthKit } from '@running/healthkit'

export const isNativeHealthAvailable = () => Capacitor.getPlatform() === 'ios'

export async function authorizeHealthKit() {
  if (!isNativeHealthAvailable()) return { authorized: false }
  return HealthKit.requestAuthorization()
}

export async function saveRunToHealth(run, coords = []) {
  if (!isNativeHealthAvailable()) throw new Error('Apple 건강 저장은 iOS 앱에서만 사용할 수 있습니다.')
  const start = new Date(`${run.date}T07:00:00`).toISOString()
  return HealthKit.saveRun({
    date: start,
    distance: run.distance,
    duration: run.duration,
    calories: run.calories,
    hr: run.hr,
    coords,
  })
}
