import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts'

const BIN_ID = '6a212290da38895dfe84f187'
const API_KEY = '$2a$10$S4L4AI6Ixu.mcfT/xS3q4.37HRowJYcmydaG/Ib41bUflr2jIC.lS'
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`
const CLAUDE_API = 'https://api.anthropic.com/v1/messages'

const GOALS = { weeklyKm: 30, monthlyKm: 120, targetPace: 6.0 }
const TABS = ['대시보드', 'AI 코치', '단축어 가이드']
const SHORTCUTS = [
  { keys: 'N', desc: '새 러닝 기록 추가' },
  { keys: 'D', desc: '대시보드 탭으로 이동' },
  { keys: 'A', desc: 'AI 코치 탭으로 이동' },
  { keys: 'G', desc: '단축어 가이드 탭으로 이동' },
  { keys: 'R', desc: '데이터 새로고침' },
  { keys: 'Esc', desc: '모달/입력 닫기' },
  { keys: '↑ / ↓', desc: '목록에서 기록 탐색' },
  { keys: 'Del', desc: '선택한 기록 삭제' },
]

function paceToStr(pace) {
  if (!pace || pace <= 0) return '-'
  const min = Math.floor(pace)
  const sec = Math.round((pace - min) * 60)
  return `${min}:${sec.toString().padStart(2, '0')}`
}

function GoalRing({ label, value, goal, unit, color }) {
  const pct = Math.min(100, Math.round((value / goal) * 100))
  const r = 38
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center', flex: '1 1 120px' }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#2e303a" strokeWidth="9" />
        <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 48 48)"
          style={{ transition: 'stroke-dasharray 0.7s ease' }}
        />
        <text x="48" y="44" textAnchor="middle" fill="#f3f4f6" fontSize="14" fontWeight="bold">{pct}%</text>
        <text x="48" y="60" textAnchor="middle" fill="#9ca3af" fontSize="9">
          {value}{unit} / {goal}{unit}
        </text>
      </svg>
      <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4 }}>{label}</div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 12, padding: '16px 20px', flex: '1 1 130px', minWidth: 120 }}>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 6 }}>{label}</div>
      <div style={{ color: color || '#c084fc', fontSize: 24, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 12, padding: '20px', flex: '1 1 280px', minWidth: 260 }}>
      <div style={{ color: '#9ca3af', fontSize: 13, fontWeight: 500, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  )
}

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
  background: '#2e303a', border: '1px solid #4b5563', borderRadius: 8,
  padding: '10px 14px', color: '#f3f4f6', fontSize: 14, outline: 'none',
}

function btn(bg) {
  return {
    background: bg, border: 'none', borderRadius: 8, padding: '9px 18px',
    color: '#f3f4f6', cursor: 'pointer', fontSize: 14, fontWeight: 500,
    transition: 'opacity 0.2s', whiteSpace: 'nowrap',
  }
}

const tooltipStyle = { contentStyle: { background: '#1f2028', border: '1px solid #2e303a', borderRadius: 8 }, labelStyle: { color: '#f3f4f6' } }

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
  const [claudeKey, setClaudeKey] = useState('')
  const [error, setError] = useState('')

  const fetchRuns = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(JSONBIN_URL + '/latest', {
        headers: { 'X-Master-Key': API_KEY }
      })
      const data = await res.json()
      setRuns(data.record?.runs || [])
    } catch {
      setError('데이터 로드에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  const saveRuns = async (newRuns) => {
    const res = await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY },
      body: JSON.stringify({ runs: newRuns })
    })
    if (!res.ok) throw new Error('저장 실패')
  }

  useEffect(() => { fetchRuns() }, [fetchRuns])

  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const k = e.key
      if (k === 'n' || k === 'N') setShowForm(true)
      else if (k === 'd' || k === 'D') setTab(0)
      else if (k === 'a' || k === 'A') setTab(1)
      else if (k === 'g' || k === 'G') setTab(2)
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
        date: form.date,
        distance: parseFloat(form.distance),
        pace: parseFloat(form.pace) || 0,
        hr: parseInt(form.hr) || 0,
        calories: parseInt(form.calories) || 0,
        note: form.note,
      }
      const newRuns = [...runs, entry].sort((a, b) => a.date.localeCompare(b.date))
      await saveRuns(newRuns)
      setRuns(newRuns)
      setForm({ date: '', distance: '', pace: '', hr: '', calories: '', note: '' })
      setShowForm(false)
    } catch {
      setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (idx) => {
    const newRuns = runs.filter((_, i) => i !== idx)
    await saveRuns(newRuns)
    setRuns(newRuns)
    setSelectedIdx(null)
  }

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

  const askAI = async () => {
    if (!aiInput.trim() || !claudeKey) return
    const userMsg = aiInput.trim()
    const nextMessages = [...aiMessages, { role: 'user', content: userMsg }]
    setAiMessages(nextMessages)
    setAiInput('')
    setAiLoading(true)
    const summary = `이번주 ${weekKm}km (${weekRuns.length}회), 이번달 ${monthKm}km (${monthRuns.length}회), 평균 페이스 ${paceToStr(avgPace)}/km, 평균 심박수 ${avgHr}bpm, 총 소모 칼로리 ${totalCal}kcal. 최근 기록: ${recent.slice(-3).map(r => `${r.date} ${r.distance}km`).join(', ')}`
    try {
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: `당신은 전문 러닝 코치입니다. 사용자 러닝 데이터: ${summary}\n\n이 데이터를 바탕으로 구체적이고 실용적인 한국어 조언을 제공하세요.`,
          messages: nextMessages,
        })
      })
      const data = await res.json()
      setAiMessages(m => [...m, { role: 'assistant', content: data.content?.[0]?.text || '응답을 받지 못했습니다.' }])
    } catch {
      setAiMessages(m => [...m, { role: 'assistant', content: '오류가 발생했습니다. API 키를 확인해주세요.' }])
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#16171d', color: '#f3f4f6', fontFamily: 'system-ui, "Segoe UI", sans-serif' }}>
      {/* 헤더 */}
      <div style={{ borderBottom: '1px solid #2e303a', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🏃</span>
          <span style={{ fontSize: 19, fontWeight: 700, color: '#c084fc' }}>Running Dashboard</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={fetchRuns} style={btn('#2e303a')}>↻ 새로고침</button>
          <button onClick={() => setShowForm(true)} style={btn('#7c3aed')}>+ 기록 추가</button>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2e303a', padding: '0 28px' }}>
        {TABS.map((t, i) => (
          <button key={i} onClick={() => setTab(i)} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '13px 18px',
            color: tab === i ? '#c084fc' : '#9ca3af', fontSize: 14, fontWeight: tab === i ? 700 : 400,
            borderBottom: tab === i ? '2px solid #c084fc' : '2px solid transparent',
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: '22px 28px', maxWidth: 1200, margin: '0 auto' }}>
        {error && (
          <div style={{ background: '#7f1d1d', color: '#fca5a5', padding: '10px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
            {error} <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', float: 'right' }}>✕</button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>데이터 로딩 중...</div>
        ) : (
          <>
            {/* ── 대시보드 탭 ── */}
            {tab === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                {/* 통계 카드 */}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <StatCard label="이번주 거리" value={`${weekKm} km`} sub={`${weekRuns.length}회`} color="#34d399" />
                  <StatCard label="이번달 거리" value={`${monthKm} km`} sub={`${monthRuns.length}회`} color="#60a5fa" />
                  <StatCard label="평균 페이스" value={paceToStr(avgPace)} sub="/km" color="#f472b6" />
                  <StatCard label="평균 심박수" value={avgHr ? `${avgHr} bpm` : '-'} color="#fb923c" />
                  <StatCard label="총 칼로리" value={totalCal ? `${totalCal.toLocaleString()} kcal` : '-'} color="#facc15" />
                </div>

                {/* 목표 달성 링 */}
                <div style={{ background: '#1f2028', borderRadius: 12, padding: '20px 24px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 18 }}>목표 달성률</div>
                  <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <GoalRing label="주간 목표" value={weekKm} goal={GOALS.weeklyKm} unit="km" color="#34d399" />
                    <GoalRing label="월간 목표" value={monthKm} goal={GOALS.monthlyKm} unit="km" color="#60a5fa" />
                    <GoalRing label="페이스 달성" value={avgPace > 0 ? parseFloat(Math.min(GOALS.targetPace, avgPace).toFixed(2)) : 0} goal={GOALS.targetPace} unit="분" color="#f472b6" />
                  </div>
                </div>

                {/* 차트 */}
                {recent.length > 0 && (
                  <>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      <ChartCard title="거리 추이 (km)">
                        <ResponsiveContainer width="100%" height={190}>
                          <BarChart data={recent}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                            <Tooltip {...tooltipStyle} />
                            <Bar dataKey="distance" fill="#7c3aed" radius={[4, 4, 0, 0]} name="거리(km)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartCard>
                      <ChartCard title="페이스 추이 (분/km)">
                        <ResponsiveContainer width="100%" height={190}>
                          <LineChart data={recent.filter(r => r.pace > 0)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={paceToStr} domain={['auto', 'auto']} />
                            <Tooltip {...tooltipStyle} formatter={v => [paceToStr(v), '페이스']} />
                            <Line type="monotone" dataKey="pace" stroke="#f472b6" strokeWidth={2} dot={{ fill: '#f472b6', r: 3 }} name="페이스" />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartCard>
                    </div>
                    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                      <ChartCard title="심박수 추이 (bpm)">
                        <ResponsiveContainer width="100%" height={190}>
                          <LineChart data={recent.filter(r => r.hr > 0)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                            <Tooltip {...tooltipStyle} />
                            <Line type="monotone" dataKey="hr" stroke="#fb923c" strokeWidth={2} dot={{ fill: '#fb923c', r: 3 }} name="심박수(bpm)" />
                          </LineChart>
                        </ResponsiveContainer>
                      </ChartCard>
                      <ChartCard title="칼로리 소모 (kcal)">
                        <ResponsiveContainer width="100%" height={190}>
                          <BarChart data={recent.filter(r => r.calories > 0)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                            <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                            <YAxis tick={{ fill: '#9ca3af', fontSize: 10 }} />
                            <Tooltip {...tooltipStyle} />
                            <Bar dataKey="calories" fill="#facc15" radius={[4, 4, 0, 0]} name="칼로리(kcal)" />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartCard>
                    </div>
                  </>
                )}

                {/* 기록 목록 */}
                <div style={{ background: '#1f2028', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid #2e303a', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600 }}>전체 기록</span>
                    <span style={{ color: '#6b7280', fontSize: 13 }}>총 {runs.length}회 | ↑↓로 선택, Del로 삭제</span>
                  </div>
                  {runs.length === 0 ? (
                    <div style={{ padding: 40, textAlign: 'center', color: '#6b7280' }}>
                      기록이 없습니다. <strong>N</strong> 키 또는 + 버튼으로 추가하세요.
                    </div>
                  ) : (
                    <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '100px 80px 90px 80px 90px 1fr 70px', padding: '8px 20px', background: '#2e303a', fontSize: 12, color: '#6b7280' }}>
                        <span>날짜</span><span>거리</span><span>페이스</span><span>심박수</span><span>칼로리</span><span>메모</span><span></span>
                      </div>
                      {[...runs].reverse().map((r, i) => {
                        const origIdx = runs.length - 1 - i
                        const sel = selectedIdx === origIdx
                        return (
                          <div key={i} onClick={() => setSelectedIdx(sel ? null : origIdx)}
                            style={{
                              display: 'grid', gridTemplateColumns: '100px 80px 90px 80px 90px 1fr 70px',
                              alignItems: 'center', padding: '11px 20px',
                              borderBottom: '1px solid #2e303a', cursor: 'pointer', fontSize: 14,
                              background: sel ? '#2e1f4a' : 'transparent',
                            }}>
                            <span style={{ color: '#9ca3af', fontSize: 13 }}>{r.date}</span>
                            <span style={{ color: '#34d399', fontWeight: 600 }}>{r.distance}km</span>
                            <span style={{ color: '#f472b6' }}>{paceToStr(r.pace)}</span>
                            <span style={{ color: '#fb923c' }}>{r.hr || '-'}</span>
                            <span style={{ color: '#facc15' }}>{r.calories || '-'}</span>
                            <span style={{ color: '#6b7280', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</span>
                            {sel && (
                              <button onClick={e => { e.stopPropagation(); handleDelete(origIdx) }}
                                style={{ ...btn('#7f1d1d'), fontSize: 12, padding: '4px 10px' }}>삭제</button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── AI 코치 탭 ── */}
            {tab === 1 && (
              <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: '#1f2028', borderRadius: 12, padding: 20 }}>
                  <label style={{ display: 'block', marginBottom: 7, color: '#9ca3af', fontSize: 13 }}>Claude API Key</label>
                  <input type="password" value={claudeKey} onChange={e => setClaudeKey(e.target.value)}
                    placeholder="sk-ant-..." style={inputStyle} />
                  <p style={{ color: '#6b7280', fontSize: 12, margin: '8px 0 0' }}>
                    API 키는 브라우저에서만 사용되며 저장되지 않습니다. 러닝 데이터를 자동으로 컨텍스트에 포함합니다.
                  </p>
                </div>
                <div style={{ background: '#1f2028', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
                  <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, minHeight: 300 }}>
                    {aiMessages.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#6b7280', padding: '40px 0' }}>
                        <div style={{ fontSize: 28, marginBottom: 10 }}>🤖</div>
                        <div>AI 러닝 코치에게 질문하세요</div>
                        <div style={{ fontSize: 13, marginTop: 6 }}>"이번주 훈련 평가해줘", "페이스 향상 방법", "다음 훈련 계획"</div>
                      </div>
                    )}
                    {aiMessages.map((m, i) => (
                      <div key={i} style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: '82%', background: m.role === 'user' ? '#5b21b6' : '#2e303a',
                        borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                        padding: '10px 14px', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                      }}>{m.content}</div>
                    ))}
                    {aiLoading && (
                      <div style={{ alignSelf: 'flex-start', background: '#2e303a', borderRadius: '14px 14px 14px 4px', padding: '10px 14px', color: '#9ca3af', fontSize: 14 }}>
                        답변 생성 중...
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI() } }}
                      placeholder={claudeKey ? '질문 입력 후 Enter...' : 'API 키를 먼저 입력하세요'}
                      style={{ ...inputStyle, flex: 1 }} disabled={!claudeKey} />
                    <button onClick={askAI} disabled={!claudeKey || !aiInput.trim() || aiLoading} style={btn('#7c3aed')}>전송</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── 단축어 가이드 탭 ── */}
            {tab === 2 && (
              <div style={{ maxWidth: 580, margin: '0 auto' }}>
                <div style={{ background: '#1f2028', borderRadius: 12, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 24px', borderBottom: '1px solid #2e303a' }}>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>⌨️ 키보드 단축키</div>
                    <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>입력 필드 밖에서 사용 가능합니다</div>
                  </div>
                  {SHORTCUTS.map((s, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', padding: '14px 24px',
                      borderBottom: i < SHORTCUTS.length - 1 ? '1px solid #2e303a' : 'none',
                    }}>
                      <kbd style={{
                        background: '#2e303a', border: '1px solid #4b5563', borderRadius: 6,
                        padding: '4px 12px', fontFamily: 'monospace', fontSize: 13,
                        color: '#c084fc', minWidth: 64, textAlign: 'center', marginRight: 20, flexShrink: 0,
                      }}>{s.keys}</kbd>
                      <span style={{ color: '#d1d5db', fontSize: 14 }}>{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 기록 추가 모달 */}
      {showForm && (
        <div onClick={e => e.target === e.currentTarget && setShowForm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: '#1f2028', borderRadius: 16, padding: '28px 32px', width: 440, maxWidth: '95vw' }}>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 22 }}>새 러닝 기록 추가</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <FormField label="날짜 *">
                <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="거리 (km) *">
                <input type="number" step="0.1" min="0" placeholder="5.0" value={form.distance}
                  onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="페이스 (분/km, 예: 5.5 = 5분30초)">
                <input type="number" step="0.01" min="0" placeholder="5.30" value={form.pace}
                  onChange={e => setForm(f => ({ ...f, pace: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="평균 심박수 (bpm)">
                <input type="number" min="0" placeholder="150" value={form.hr}
                  onChange={e => setForm(f => ({ ...f, hr: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="칼로리 (kcal)">
                <input type="number" min="0" placeholder="400" value={form.calories}
                  onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} style={inputStyle} />
              </FormField>
              <FormField label="메모">
                <input placeholder="코스, 컨디션 등" value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} />
              </FormField>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={btn('#2e303a')}>취소</button>
              <button onClick={handleAdd} disabled={saving || !form.date || !form.distance} style={btn('#7c3aed')}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
