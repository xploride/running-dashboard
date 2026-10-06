export interface HealthRun {
  externalId?: string
  date: string
  distance: number
  duration: number
  calories?: number
  hr?: number
  coords?: Array<{ lat: number; lng: number; elevation?: number | null; time?: string | null }>
}

export interface ImportedHealthRun extends HealthRun {
  id: string
  startedAt: string
  pace: number
  note: string
  source: 'healthkit'
}

export interface HealthKitPlugin {
  isAvailable(): Promise<{ available: boolean }>
  requestAuthorization(): Promise<{ authorized: boolean }>
  readRuns(options?: { days?: number; includeRoutes?: boolean }): Promise<{ runs: ImportedHealthRun[] }>
  saveRun(run: HealthRun): Promise<{ saved: boolean; routeSaved: boolean; workoutId?: string; warning?: string }>
}

export declare const HealthKit: HealthKitPlugin
