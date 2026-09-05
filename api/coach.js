import Anthropic from '@anthropic-ai/sdk'

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'POST 요청만 지원합니다.' })
  if (!process.env.ANTHROPIC_API_KEY) return response.status(503).json({ error: 'AI 코치가 아직 연결되지 않았습니다.' })

  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body
    const message = String(body?.message || '').slice(0, 800)
    const runs = Array.isArray(body?.runs) ? body.runs.slice(-20) : []
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      system: '당신은 간결하고 현실적인 러닝 코치입니다. 의료 진단을 하지 말고, 제공된 기록을 바탕으로 한국어로 3~5문장 이내의 실행 가능한 조언을 주세요.',
      messages: [{ role: 'user', content: `최근 기록: ${JSON.stringify(runs)}\n\n질문: ${message}` }],
    })
    const answer = result.content.find((item) => item.type === 'text')?.text || ''
    return response.status(200).json({ answer })
  } catch (error) {
    console.error('coach API failed', error)
    return response.status(500).json({ error: '코치 응답을 만들지 못했습니다.' })
  }
}
