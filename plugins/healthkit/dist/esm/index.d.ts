export interface HealthRun {
  date: string
  distance: number
  duration: number
  calories?: number
  hr?: number
  coords?: Array<{ lat: number; lng: number }>
}

export interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>
  requestAuthorization(): Promise<{ authorized: boolean }>
  saveRun(run: HealthRun): Promise<{ saved: boolean; workoutId?: string }>
}

export declare const HealthKit: HealthKitPlugin
