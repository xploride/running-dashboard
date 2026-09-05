const KM_PER_MILE = 1.609344

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeRun(run, index = 0) {
  const distance = Number(run.distance) || 0
  const pace = Number(run.pace) || 0
  const duration = Number(run.duration) || Math.round(distance * pace * 60)
  return {
    id: run.id || `${run.date || 'run'}-${distance.toFixed(2)}-${index}`,
    date: run.date || localDateKey(),
    distance,
    duration,
    pace: pace || (distance > 0 && duration > 0 ? duration / 60 / distance : 0),
    hr: Number(run.hr) || 0,
    calories: Number(run.calories) || 0,
    elevation: Number(run.elevation) || 0,
    note: run.note || '',
    source: run.source || (String(run.note).toLowerCase().includes('gpx') ? 'gpx' : 'manual'),
  }
}

export function paceText(value) {
  if (!value || !Number.isFinite(Number(value))) return '--:--'
  const totalSeconds = Math.round(Number(value) * 60)
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

export function durationText(seconds) {
  if (!seconds) return '--'
  const total = Math.round(Number(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}` : `${minutes}:${String(secs).padStart(2, '0')}`
}

export function haversine(a, b) {
  const rad = (value) => value * Math.PI / 180
  const earthRadius = 6371
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function xmlDocument(text, label) {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.querySelector('parsererror')) throw new Error(`${label} 파일을 읽을 수 없습니다.`)
  return document
}

function elementText(node, localName) {
  const namespaced = node.getElementsByTagNameNS('*', localName)
  return namespaced[0]?.textContent?.trim() || node.querySelector(localName)?.textContent?.trim() || ''
}

export function parseGpx(text, fileName = 'route.gpx') {
  const document = xmlDocument(text, 'GPX')
  const nodes = [...document.querySelectorAll('trkpt, rtept, wpt')]
  if (nodes.length < 2) throw new Error('GPX 경로 좌표가 2개 미만입니다.')

  const points = nodes.map((node) => {
    const lat = Number(node.getAttribute('lat'))
    const lng = Number(node.getAttribute('lon'))
    const elevation = Number(elementText(node, 'ele'))
    const time = elementText(node, 'time')
    const heartRate = Number(elementText(node, 'hr'))
    return {
      lat,
      lng,
      elevation: Number.isFinite(elevation) ? elevation : null,
      time: time || null,
      hr: Number.isFinite(heartRate) ? heartRate : null,
    }
  }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)

  if (points.length < 2) throw new Error('GPX에 유효한 경로가 없습니다.')

  let distance = 0
  let elevation = 0
  for (let index = 1; index < points.length; index += 1) {
    distance += haversine(points[index - 1], points[index])
    const gain = (points[index].elevation ?? 0) - (points[index - 1].elevation ?? 0)
    if (gain > 1) elevation += gain
  }

  const timestamps = points.map((point) => Date.parse(point.time)).filter(Number.isFinite)
  const start = timestamps.length ? Math.min(...timestamps) : Date.now()
  const end = timestamps.length ? Math.max(...timestamps) : start
  const duration = Math.max(0, Math.round((end - start) / 1000))
  const heartRates = points.map((point) => point.hr).filter((value) => value > 0)
  const hr = heartRates.length ? Math.round(heartRates.reduce((sum, value) => sum + value, 0) / heartRates.length) : 0
  const name = document.querySelector('trk > name, rte > name, metadata > name')?.textContent?.trim() || fileName.replace(/\.gpx$/i, '')
  const date = localDateKey(new Date(start))
  const roundedDistance = Number(distance.toFixed(2))

  return {
    coords: points.map(({ lat, lng }) => ({ lat, lng })),
    run: normalizeRun({
      id: `gpx-${date}-${start}`,
      date,
      distance: roundedDistance,
      duration,
      pace: roundedDistance && duration ? duration / 60 / roundedDistance : 0,
      hr,
      calories: 0,
      elevation: Math.round(elevation),
      note: name,
      source: 'gpx',
    }),
  }
}

function workoutStat(workout, typeFragment) {
  const stat = [...workout.querySelectorAll('WorkoutStatistics')].find((node) => node.getAttribute('type')?.includes(typeFragment))
  if (!stat) return 0
  return Number(stat.getAttribute('sum') || stat.getAttribute('average') || 0)
}

export function parseAppleHealth(text) {
  const document = xmlDocument(text, 'Apple Health XML')
  const workouts = [...document.querySelectorAll('Workout')].filter((node) => node.getAttribute('workoutActivityType')?.includes('Running'))
  if (!workouts.length) throw new Error('러닝 운동 기록을 찾지 못했습니다.')

  return workouts.map((workout, index) => {
    const startDate = workout.getAttribute('startDate') || workout.getAttribute('creationDate')
    let distance = Number(workout.getAttribute('totalDistance')) || workoutStat(workout, 'DistanceWalkingRunning')
    const distanceUnit = workout.getAttribute('totalDistanceUnit') || [...workout.querySelectorAll('WorkoutStatistics')].find((node) => node.getAttribute('type')?.includes('DistanceWalkingRunning'))?.getAttribute('unit')
    if (distanceUnit === 'm') distance /= 1000
    if (distanceUnit === 'mi') distance *= KM_PER_MILE

    let duration = Number(workout.getAttribute('duration')) || 0
    const durationUnit = workout.getAttribute('durationUnit') || 'min'
    if (durationUnit === 'min') duration *= 60
    if (durationUnit === 'h') duration *= 3600

    const calories = Number(workout.getAttribute('totalEnergyBurned')) || workoutStat(workout, 'ActiveEnergyBurned')
    const hr = workoutStat(workout, 'HeartRate')
    return normalizeRun({
      id: `health-${Date.parse(startDate) || index}`,
      date: localDateKey(startDate),
      distance: Number(distance.toFixed(2)),
      duration: Math.round(duration),
      pace: distance > 0 ? duration / 60 / distance : 0,
      hr: Math.round(hr),
      calories: Math.round(calories),
      note: 'Apple Health',
      source: 'health',
    }, index)
  }).filter((run) => run.distance > 0)
}

const ROUTE_SESSION_KEY = 'running-dashboard.routes.v2'

export function loadSessionRoutes() {
  try {
    return JSON.parse(sessionStorage.getItem(ROUTE_SESSION_KEY) || '{}')
  } catch {
    return {}
  }
}

export function saveSessionRoutes(routes) {
  try {
    sessionStorage.setItem(ROUTE_SESSION_KEY, JSON.stringify(routes))
  } catch {
    // Oversized tracks still remain available in React state for this page session.
  }
}

export function mergeRuns(existing, incoming) {
  const keys = new Set(existing.map((run) => `${run.date}:${Math.round(run.distance * 100)}`))
  const additions = incoming.filter((run) => !keys.has(`${run.date}:${Math.round(run.distance * 100)}`))
  return {
    added: additions.length,
    runs: [...existing, ...additions].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export function weeklyDistance(runs, now = new Date()) {
  const day = (now.getDay() + 6) % 7
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - day)
  return runs.filter((run) => new Date(`${run.date}T12:00:00`) >= start).reduce((sum, run) => sum + run.distance, 0)
}

