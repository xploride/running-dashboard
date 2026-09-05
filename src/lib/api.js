async function request(path = '', options = {}) {
  const response = await fetch(`/api/runs${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `요청 실패 (HTTP ${response.status})`)
  return payload
}

export async function getRuns() {
  const payload = await request()
  return Array.isArray(payload.runs) ? payload.runs : []
}

export async function putRuns(runs) {
  const summaries = runs.map(({ id, date, distance, duration, pace, hr, calories, elevation, note, source }) => ({
    id, date, distance, duration, pace, hr, calories, elevation, note, source,
  }))
  return request('', { method: 'PUT', body: JSON.stringify({ runs: summaries }) })
}

export async function askCoach(message, runs) {
  try {
    const response = await fetch('/api/coach', {
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
