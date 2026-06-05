import { useState, useEffect, useCallback, useRef } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

const BIN_ID = '6a212290da38895dfe84f187'
const API_KEY = '$2a$10$S4L4AI6Ixu.mcfT/xS3q4.37HRowJYcmydaG/Ib41bUflr2jIC.lS'
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`
const CLAUDE_API = 'https://api.anthropic.com/v1/messages'
const GOALS = { weeklyKm: 30, monthlyKm: 120, targetPace: 6.0 }

const TABS = [
  { id: 0, label: '홈', icon: '🏠' },
  { id: 1, label: '기록', icon: '📋' },
  { id: 2, label: 'AI 코치', icon: '🤖' },
  { id: 3, label: '설정', icon: '⚙️' },
]

const SHORTCUTS = [
  { keys: 'N', desc: '새 러닝 기록 추가' },
  { keys: 'D', desc: '홈 탭으로 이동' },
  { keys: 'A', desc: 'AI 코치 탭으로 이동' },
  { keys: 'R', desc: '데이터 새로고침' },
  { keys: 'Esc', desc: '모달 닫기' },
  { keys: '↑ / ↓', desc: '기록 목록 탐색' },
  { keys: 'Del', desc: '선택한 기록 삭제' },
]

function paceToStr(pace) {
  if (!pace || pace <= 0) return '-'
  const min = Math.floor(pace)
  const sec = Math.round((pace - min) * 60)
  return `${min}:${sec.toString().padStart(2, '0')}`
}

/* ── 목표 달성 링 ── */
function GoalRing({ label, value, goal, unit, color }) {
  const pct = Math.min(100, Math.round((value / goal) * 100))
  const r = 34, circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center', flex: '1 1 100px' }}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#2e303a" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 42 42)"
          style={{ transition: 'stroke-dasharray 0.7s ease' }} />
        <text x="42" y="38" textAnchor="middle" fill="#f3f4f6" fontSize="13" fontWeight="bold">{pct}%</text>
        <text x="42" y="53" textAnchor="middle" fill="#9ca3af" fontSize="8">{value}{unit}/{goal}{unit}</text>
      </svg>
      <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  )
}

/* ── 통계 카드 ── */
function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 14, padding: '14px 16px', flex: '1 1 130px', minWidth: 120 }}>
      <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 5 }}>{label}</div>
      <div style={{ color: color || '#c084fc', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

/* ── 차트 카드 ── */
function ChartCard({ title, children }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 14, padding: '16px', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

/* ── 폼 필드 ── */
function FormField({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', color: '#9ca3af', fontSize: 13, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#2e303a', border: '1px solid #4b5563', borderRadius: 10,
  padding: '12px 14px', color: '#f3f4f6', fontSize: 16, outline: 'none',
  WebkitAppearance: 'none',
}

const tooltipStyle = {
  contentStyle: { background: '#1f2028', border: '1px solid #2e303a', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#f3f4f6' },
}

function TouchBtn({ onClick, children, color = '#7c3aed', disabled, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: color, border: 'none', borderRadius: 12, padding: '14px 20px',
      color: '#f3f4f6', cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: 15, fontWeight: 600, opacity: disabled ? 0.5 : 1,
      minHeight: 48, WebkitTapHighlightColor: 'transparent',
      touchAction: 'manipulation', transition: 'opacity 0.15s',
      ...style,
    }}>{children}</button>
  )
}

/* ════════════════════════════════════════ */
export default function App() {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ date: '', distance: '', pace: '', hr: '', calories: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [aiInput, setAiInput] = useState('')
  const [aiMessages, setAiMessages] = useState([])
  const [aiLoading, setAiLoading] = useState(false)
  const [claudeKey, setClaudeKey] = useState(() => localStorage.getItem('claudeKey') || '')
  const [error, setError] = useState('')
  const aiEndRef = useRef(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': API_KEY } })
      const data = await res.json()
      setRuns(data.record?.runs || [])
    } catch { setError('데이터 로드 실패') }
    finally { setLoading(false) }
  }, [])

  const saveRuns = async (newRuns) => {
    const res = await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY },
      body: JSON.stringify({ runs: newRuns }),
    })
    if (!res.ok) throw new Error('저장 실패')
  }

  useEffect(() => { fetchRuns() }, [fetchRuns])

  useEffect(() => {
    if (aiEndRef.current) aiEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [aiMessages, aiLoading])

  /* 키보드 단축키 */
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const k = e.key
      if (k === 'n' || k === 'N') setShowForm(true)
      else if (k === 'd' || k === 'D') setTab(0)
      else if (k === 'a' || k === 'A') setTab(2)
      else if (k === 'r' || k === 'R') fetchRuns()
      else if (k === 'Escape') { setShowForm(false); setSelectedIdx(null) }
      else if (k === 'ArrowDown') setSelectedIdx(i => i === null ? 0 : Math.min(i + 1, runs.length - 1))
      else if (k === 'ArrowUp') setSelectedIdx(i => i === null ? 0 : Math.max(i - 1, 0))
      else if (k === 'Delete' && selectedIdx !== null) handleDelete(selectedIdx)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [runs.length, selectedIdx, fetchRuns])

  const handleAdd = async () => {
    if (!form.date || !form.distance) return
    setSaving(true)
    try {
      const entry = {
        date: form.date, distance: parseFloat(form.distance),
        pace: parseFloat(form.pace) || 0, hr: parseInt(form.hr) || 0,
        calories: parseInt(form.calories) || 0, note: form.note,
      }
      const newRuns = [...runs, entry].sort((a, b) => a.date.localeCompare(b.date))
      await saveRuns(newRuns)
      setRuns(newRuns)
      setForm({ date: '', distance: '', pace: '', hr: '', calories: '', note: '' })
      setShowForm(false)
    } catch { setError('저장 실패') }
    finally { setSaving(false) }
  }

  const handleDelete = async (idx) => {
    const newRuns = runs.filter((_, i) => i !== idx)
    await saveRuns(newRuns)
    setRuns(newRuns); setSelectedIdx(null)
  }

  /* 통계 */
  const now = new Date()
  const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const weekRuns = runs.filter(r => r.date >= weekAgo)
  const monthRuns = runs.filter(r => r.date >= monthStart)
  const weekKm = parseFloat(weekRuns.reduce((s, r) => s + r.distance, 0).toFixed(1))
  const monthKm = parseFloat(monthRuns.reduce((s, r) => s + r.distance, 0).toFixed(1))
  const paceRuns = runs.filter(r => r.pace > 0)
  const avgPace = paceRuns.length ? paceRuns.reduce((s, r) => s + r.pace, 0) / paceRuns.length : 0
  const hrRuns = runs.filter(r => r.hr > 0)
  const avgHr = hrRuns.length ? Math.round(hrRuns.reduce((s, r) => s + r.hr, 0) / hrRuns.length) : 0
  const totalCal = runs.reduce((s, r) => s + r.calories, 0)
  const recent = runs.slice(-14)

  /* AI 코치 */
  const askAI = async () => {
    if (!aiInput.trim() || !claudeKey) return
    const userMsg = aiInput.trim()
    const nextMsgs = [...aiMessages, { role: 'user', content: userMsg }]
    setAiMessages(nextMsgs); setAiInput(''); setAiLoading(true)
    const summary = `이번주 ${weekKm}km(${weekRuns.length}회), 이번달 ${monthKm}km(${monthRuns.length}회), 평균 페이스 ${paceToStr(avgPace)}/km, 평균 심박 ${avgHr}bpm, 총 칼로리 ${totalCal}kcal`
    try {
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', max_tokens: 1024,
          system: `당신은 전문 러닝 코치입니다. 사용자 데이터: ${summary}. 구체적이고 실용적인 한국어 조언을 제공하세요.`,
          messages: nextMsgs,
        }),
      })
      const data = await res.json()
      setAiMessages(m => [...m, { role: 'assistant', content: data.content?.[0]?.text || '응답 없음' }])
    } catch {
      setAiMessages(m => [...m, { role: 'assistant', content: '오류가 발생했습니다. API 키를 확인해주세요.' }])
    } finally { setAiLoading(false) }
  }

  const saveClaudeKey = (key) => {
    setClaudeKey(key)
    localStorage.setItem('claudeKey', key)
  }

  /* ── 렌더 ── */
  return (
    <div style={{
      minHeight: '100dvh', background: '#16171d', color: '#f3f4f6',
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      display: 'flex', flexDirection: 'column',
      paddingBottom: 'calc(64px + env(safe-area-inset-bottom))',
    }}>
      {/* 상단 헤더 */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: '#16171d', borderBottom: '1px solid #2e303a',
        padding: 'calc(env(safe-area-inset-top) + 12px) 16px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🏃</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#c084fc' }}>러닝 대시보드</span>
        </div>
        <button onClick={fetchRuns} style={{
          background: 'none', border: '1px solid #2e303a', borderRadius: 8,
          color: '#9ca3af', padding: '7px 12px', fontSize: 13, cursor: 'pointer',
          minHeight: 36, WebkitTapHighlightColor: 'transparent',
        }}>↻</button>
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ margin: '12px 16px 0', background: '#7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>로딩 중...</div>
        ) : (
          <>
            {/* ── 홈 탭 ── */}
            {tab === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 빠른 추가 버튼 */}
                <TouchBtn onClick={() => setShowForm(true)} style={{ width: '100%', fontSize: 16 }}>
                  + 오늘 러닝 기록 추가
                </TouchBtn>

                {/* 통계 카드 */}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <StatCard label="이번주" value={`${weekKm}km`} sub={`${weekRuns.length}회`} color="#34d399" />
                  <StatCard label="이번달" value={`${monthKm}km`} sub={`${monthRuns.length}회`} color="#60a5fa" />
                  <StatCard label="평균 페이스" value={paceToStr(avgPace)} sub="/km" color="#f472b6" />
                  <StatCard label="평균 심박" value={avgHr ? `${avgHr}bpm` : '-'} color="#fb923c" />
                  <StatCard label="총 칼로리" value={totalCal ? `${totalCal.toLocaleString()}` : '-'} sub="kcal" color="#facc15" />
                </div>

                {/* 목표 링 */}
                <div style={{ background: '#1f2028', borderRadius: 14, padding: '16px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 14 }}>목표 달성률</div>
                  <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                    <GoalRing label="주간 목표" value={weekKm} goal={GOALS.weeklyKm} unit="km" color="#34d399" />
                    <GoalRing label="월간 목표" value={monthKm} goal={GOALS.monthlyKm} unit="km" color="#60a5fa" />
                    <GoalRing label="페이스 목표" value={avgPace > 0 ? parseFloat(Math.min(GOALS.targetPace, avgPace).toFixed(2)) : 0} goal={GOALS.targetPace} unit="분" color="#f472b6" />
                  </div>
                </div>

                {/* 차트 */}
                {recent.length > 0 && (
                  <>
                    <ChartCard title="거리 추이 (km)">
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={recent} margin={{ left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                          <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                          <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} />
                          <Tooltip {...tooltipStyle} />
                          <Bar dataKey="distance" fill="#7c3aed" radius={[4, 4, 0, 0]} name="거리(km)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                    <ChartCard title="페이스 추이 (분/km)">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={recent.filter(r => r.pace > 0)} margin={{ left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                          <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                          <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={paceToStr} domain={['auto', 'auto']} />
                          <Tooltip {...tooltipStyle} formatter={v => [paceToStr(v), '페이스']} />
                          <Line type="monotone" dataKey="pace" stroke="#f472b6" strokeWidth={2} dot={false} name="페이스" />
                        </LineChart>
                      </ResponsiveContainer>
                    </ChartCard>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <ChartCard title="심박수 (bpm)">
                        <ResponsiveContainer width="100%" height={140}>
                          <LineChart data={recent.filter(r => r.hr > 0)} margin={{ left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} />
                            <Tooltip {...tooltipStyle} />
                            <Line type="monotone" dataKey="hr" stroke="#fb923c" strokeWidth={2} dot={false} name="심박수" />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartCard>
                      <ChartCard title="칼로리 (kcal)">
                        <ResponsiveContainer width="100%" height={140}>
                          <BarChart data={recent.filter(r => r.calories > 0)} margin={{ left: -20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} />
                            <Tooltip {...tooltipStyle} />
                            <Bar dataKey="calories" fill="#facc15" radius={[4, 4, 0, 0]} name="칼로리" />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartCard>
                    </div>
                  </>
                )}
                {recent.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🏃</div>
                    <div>아직 기록이 없습니다</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>위 버튼으로 첫 러닝을 기록해보세요!</div>
                  </div>
                )}
              </div>
            )}

            {/* ── 기록 탭 ── */}
            {tab === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>전체 기록 ({runs.length}회)</span>
                  <TouchBtn onClick={() => setShowForm(true)} style={{ padding: '10px 16px', fontSize: 14 }}>+ 추가</TouchBtn>
                </div>
                {runs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>기록이 없습니다.</div>
                ) : (
                  [...runs].reverse().map((r, i) => {
                    const origIdx = runs.length - 1 - i
                    const sel = selectedIdx === origIdx
                    return (
                      <div key={i} onClick={() => setSelectedIdx(sel ? null : origIdx)}
                        style={{
                          background: sel ? '#2e1f4a' : '#1f2028', borderRadius: 14,
                          padding: '14px 16px', cursor: 'pointer',
                          border: sel ? '1px solid #7c3aed' : '1px solid transparent',
                          transition: 'all 0.15s',
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ color: '#9ca3af', fontSize: 13 }}>{r.date}</span>
                          <span style={{ color: '#34d399', fontWeight: 700, fontSize: 16 }}>{r.distance} km</span>
                        </div>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#f472b6' }}>⏱ {paceToStr(r.pace)}/km</span>
                          {r.hr > 0 && <span style={{ fontSize: 13, color: '#fb923c' }}>❤️ {r.hr}bpm</span>}
                          {r.calories > 0 && <span style={{ fontSize: 13, color: '#facc15' }}>🔥 {r.calories}kcal</span>}
                        </div>
                        {r.note && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>{r.note}</div>}
                        {sel && (
                          <div style={{ marginTop: 12 }}>
                            <TouchBtn onClick={e => { e.stopPropagation(); handleDelete(origIdx) }}
                              color="#7f1d1d" style={{ width: '100%', fontSize: 14, padding: '11px' }}>
                              이 기록 삭제
                            </TouchBtn>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* ── AI 코치 탭 ── */}
            {tab === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100dvh - 180px)' }}>
                {!claudeKey && (
                  <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 8 }}>Claude API Key</div>
                    <input type="password" placeholder="sk-ant-..."
                      onChange={e => saveClaudeKey(e.target.value)}
                      style={inputStyle} />
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 8 }}>설정 탭에서도 입력할 수 있습니다.</div>
                  </div>
                )}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {aiMessages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>
                      <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>AI 러닝 코치</div>
                      <div style={{ fontSize: 13 }}>러닝 데이터를 분석해 맞춤 조언을 드립니다</div>
                      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {['이번주 훈련 평가해줘', '페이스 향상 방법 알려줘', '다음 훈련 계획 세워줘'].map(q => (
                          <button key={q} onClick={() => setAiInput(q)}
                            style={{ background: '#2e303a', border: 'none', borderRadius: 20, padding: '10px 16px', color: '#c084fc', cursor: 'pointer', fontSize: 14 }}>
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiMessages.map((m, i) => (
                    <div key={i} style={{
                      alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '85%', background: m.role === 'user' ? '#5b21b6' : '#2e303a',
                      borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                      padding: '12px 16px', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                    }}>{m.content}</div>
                  ))}
                  {aiLoading && (
                    <div style={{ alignSelf: 'flex-start', background: '#2e303a', borderRadius: '18px 18px 18px 4px', padding: '12px 16px', color: '#9ca3af', fontSize: 14 }}>
                      답변 생성 중...
                    </div>
                  )}
                  <div ref={aiEndRef} />
                </div>
                <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
                  <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI() } }}
                    placeholder={claudeKey ? '질문 입력...' : 'API 키를 설정하세요'}
                    style={{ ...inputStyle, flex: 1, fontSize: 15 }}
                    disabled={!claudeKey} />
                  <TouchBtn onClick={askAI} disabled={!claudeKey || !aiInput.trim() || aiLoading}
                    style={{ padding: '12px 18px', flexShrink: 0 }}>↑</TouchBtn>
                </div>
              </div>
            )}

            {/* ── 설정 탭 ── */}
            {tab === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 14 }}>Claude API Key</div>
                  <input type="password" value={claudeKey} onChange={e => saveClaudeKey(e.target.value)}
                    placeholder="sk-ant-..." style={inputStyle} />
                  <div style={{ color: '#6b7280', fontSize: 12, marginTop: 8 }}>
                    로컬 스토리지에 저장됩니다. AI 코치 기능에 사용됩니다.
                  </div>
                  {claudeKey && (
                    <button onClick={() => saveClaudeKey('')}
                      style={{ marginTop: 10, background: 'none', border: '1px solid #4b5563', borderRadius: 8, padding: '8px 14px', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}>
                      키 삭제
                    </button>
                  )}
                </div>

                <div style={{ background: '#1f2028', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #2e303a', fontWeight: 600 }}>⌨️ 키보드 단축키</div>
                  {SHORTCUTS.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: i < SHORTCUTS.length - 1 ? '1px solid #2e303a' : 'none' }}>
                      <kbd style={{ background: '#2e303a', border: '1px solid #4b5563', borderRadius: 6, padding: '3px 10px', fontFamily: 'monospace', fontSize: 12, color: '#c084fc', minWidth: 52, textAlign: 'center', marginRight: 14, flexShrink: 0 }}>{s.keys}</kbd>
                      <span style={{ color: '#d1d5db', fontSize: 14 }}>{s.desc}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 10 }}>앱 정보</div>
                  <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.8 }}>
                    <div>버전: 1.0.0</div>
                    <div>데이터 저장: JSONBin</div>
                    <div>AI 모델: Claude Sonnet 4.6</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 하단 탭 네비게이션 */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: '#1f2028', borderTop: '1px solid #2e303a',
        display: 'flex',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, background: 'none', border: 'none', cursor: 'pointer',
            padding: '10px 4px 8px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 3, WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation', minHeight: 56,
          }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10, color: tab === t.id ? '#c084fc' : '#6b7280', fontWeight: tab === t.id ? 700 : 400 }}>
              {t.label}
            </span>
            {tab === t.id && (
              <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#c084fc', position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom) + 6px)' }} />
            )}
          </button>
        ))}
      </div>

      {/* 기록 추가 모달 (Bottom Sheet) */}
      {showForm && (
        <div onClick={e => e.target === e.currentTarget && setShowForm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{
            background: '#1f2028', borderRadius: '20px 20px 0 0',
            padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
            width: '100%', boxSizing: 'border-box',
            maxHeight: '90dvh', overflowY: 'auto',
            animation: 'slideUp 0.25s ease',
          }}>
            <div style={{ width: 40, height: 4, background: '#4b5563', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 18 }}>러닝 기록 추가</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <FormField label="날짜 *">
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="거리 (km) *">
                <input type="number" step="0.1" min="0" placeholder="5.0" value={form.distance}
                  onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} style={inputStyle} />
              </FormField>
              <div style={{ display: 'flex', gap: 10 }}>
                <FormField label="페이스 (분.초)">
                  <input type="number" step="0.01" min="0" placeholder="5.30" value={form.pace}
                    onChange={e => setForm(f => ({ ...f, pace: e.target.value }))} style={inputStyle} />
                </FormField>
                <FormField label="심박수 (bpm)">
                  <input type="number" min="0" placeholder="150" value={form.hr}
                    onChange={e => setForm(f => ({ ...f, hr: e.target.value }))} style={inputStyle} />
                </FormField>
              </div>
              <FormField label="칼로리 (kcal)">
                <input type="number" min="0" placeholder="400" value={form.calories}
                  onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="메모">
                <input placeholder="코스, 컨디션 등" value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} />
              </FormField>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <TouchBtn onClick={() => setShowForm(false)} color="#2e303a" style={{ flex: 1 }}>취소</TouchBtn>
              <TouchBtn onClick={handleAdd} disabled={saving || !form.date || !form.distance} style={{ flex: 2 }}>
                {saving ? '저장 중...' : '저장하기'}
              </TouchBtn>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        * { -webkit-tap-highlight-color: transparent; }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  )
}
