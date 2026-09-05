const JSONBIN_API = 'https://api.jsonbin.io/v3/b'

function config() {
  const key = (process.env.JSONBIN_API_KEY || process.env.VITE_JSONBIN_API_KEY || '').trim()
  const binId = (process.env.JSONBIN_BIN_ID || process.env.VITE_JSONBIN_BIN_ID || '').trim()
  if (!key || !binId) throw new Error('서버의 JSONBin 환경 변수가 설정되지 않았습니다.')
  return { key, binId }
}

function jsonbinHeaders(key) {
  return {
    'Content-Type': 'application/json',
    'X-Master-Key': key,
  }
}

function cleanRun(run, index) {
  const allowed = ['id', 'date', 'distance', 'duration', 'pace', 'hr', 'calories', 'elevation', 'note', 'source']
  return allowed.reduce((output, key) => {
    if (run[key] !== undefined) output[key] = run[key]
    return output
  }, { id: run.id || `${run.date || 'run'}-${index}` })
}

export default async function handler(request, response) {
  if (!['GET', 'PUT'].includes(request.method)) {
    response.setHeader('Allow', 'GET, PUT')
    return response.status(405).json({ error: '지원하지 않는 요청입니다.' })
  }

  try {
    const { key, binId } = config()

    if (request.method === 'GET') {
      const upstream = await fetch(`${JSONBIN_API}/${binId}/latest`, { headers: jsonbinHeaders(key) })
      const payload = await upstream.json().catch(() => ({}))
      if (!upstream.ok) {
        console.error('JSONBin GET failed', upstream.status, payload)
        return response.status(upstream.status).json({ error: `기록을 불러오지 못했습니다. (JSONBin ${upstream.status})` })
      }
      return response.status(200).json({ runs: Array.isArray(payload.record?.runs) ? payload.record.runs : [] })
    }

    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    if (!Array.isArray(body?.runs)) return response.status(400).json({ error: 'runs 배열이 필요합니다.' })
    if (body.runs.length > 5000) return response.status(413).json({ error: '한 번에 저장할 수 있는 기록 수를 초과했습니다.' })

    const runs = body.runs.map(cleanRun)
    const upstream = await fetch(`${JSONBIN_API}/${binId}`, {
      method: 'PUT',
      headers: jsonbinHeaders(key),
      body: JSON.stringify({ runs }),
    })
    const payload = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      console.error('JSONBin PUT failed', upstream.status, payload)
      return response.status(upstream.status).json({ error: `기록을 저장하지 못했습니다. (JSONBin ${upstream.status})` })
    }
    return response.status(200).json({ ok: true, count: runs.length })
  } catch (error) {
    console.error('runs API failed', error)
    return response.status(500).json({ error: error.message || '서버 오류가 발생했습니다.' })
  }
}
