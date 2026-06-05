import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader } from '@googlemaps/js-api-loader'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

/* ── 상수 ── */
const BIN_ID = '6a212290da38895dfe84f187'
const API_KEY = '$2a$10$S4L4AI6Ixu.mcfT/xS3q4.37HRowJYcmydaG/Ib41bUflr2jIC.lS'
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`
const CLAUDE_API = 'https://api.anthropic.com/v1/messages'
const GOALS = { weeklyKm: 30, monthlyKm: 120, targetPace: 6.0 }
const ANIM_SPEEDS = [
  { label: '1×', value: 1 },
  { label: '3×', value: 3 },
  { label: '10×', value: 10 },
  { label: '30×', value: 30 },
]
const ANIM_SECS_1X = 20

const TABS = [
  { id: 0, label: '홈',   icon: '🏠' },
  { id: 1, label: '기록', icon: '📋' },
  { id: 2, label: '지도', icon: '🗺️' },
  { id: 3, label: 'AI',   icon: '🤖' },
  { id: 4, label: '설정', icon: '⚙️' },
]

const SHORTCUTS = [
  { keys: 'N',     desc: '새 러닝 기록 추가' },
  { keys: 'D',     desc: '홈 탭' },
  { keys: 'A',     desc: 'AI 코치 탭' },
  { keys: 'R',     desc: '데이터 새로고침' },
  { keys: 'Esc',   desc: '모달 닫기' },
  { keys: '↑ / ↓', desc: '기록 탐색' },
  { keys: 'Del',   desc: '선택 기록 삭제' },
]

const DARK_MAP_STYLE = [
  { elementType: 'geometry',              stylers: [{ color: '#242424' }] },
  { elementType: 'labels.text.fill',      stylers: [{ color: '#9ca3af' }] },
  { elementType: 'labels.text.stroke',    stylers: [{ color: '#1f2028' }] },
  { featureType: 'poi',          elementType: 'geometry',         stylers: [{ color: '#2e303a' }] },
  { featureType: 'poi.park',     elementType: 'geometry',         stylers: [{ color: '#1a2e1a' }] },
  { featureType: 'road',         elementType: 'geometry',         stylers: [{ color: '#2e303a' }] },
  { featureType: 'road',         elementType: 'geometry.stroke',  stylers: [{ color: '#161616' }] },
  { featureType: 'road.highway', elementType: 'geometry',         stylers: [{ color: '#3e3e3e' }] },
  { featureType: 'transit',      elementType: 'geometry',         stylers: [{ color: '#2e2e2e' }] },
  { featureType: 'water',        elementType: 'geometry',         stylers: [{ color: '#0d0d0d' }] },
]

// 샘플 경로 — 서울 한강공원 인근
const SAMPLE_GPS = `[[37.5195,126.9393],[37.5199,126.9400],[37.5203,126.9408],[37.5207,126.9416],[37.5210,126.9424],[37.5213,126.9432],[37.5216,126.9440],[37.5219,126.9448],[37.5222,126.9456],[37.5225,126.9464],[37.5228,126.9472],[37.5231,126.9480],[37.5234,126.9487],[37.5237,126.9494],[37.5240,126.9500],[37.5243,126.9506],[37.5246,126.9511],[37.5248,126.9516],[37.5250,126.9521],[37.5252,126.9526],[37.5254,126.9531],[37.5256,126.9536],[37.5258,126.9541],[37.5260,126.9546],[37.5262,126.9551],[37.5264,126.9556],[37.5266,126.9561],[37.5268,126.9566],[37.5269,126.9571],[37.5270,126.9577]]`

/* ── 유틸 ── */
function paceToStr(p) {
  if (!p || p <= 0) return '-'
  const m = Math.floor(p), s = Math.round((p - m) * 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, toR = Math.PI / 180
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function parseGPS(input) {
  const raw = JSON.parse(input.trim())
  if (!Array.isArray(raw) || raw.length < 2)
    throw new Error('최소 2개 이상의 좌표 배열이어야 합니다.')
  return raw.map((p, i) => {
    if (Array.isArray(p) && p.length >= 2) return { lat: +p[0], lng: +p[1] }
    if (p && typeof p === 'object') {
      const lat = p.lat ?? p.latitude
      const lng = p.lng ?? p.longitude ?? p.lon
      if (lat != null && lng != null) return { lat: +lat, lng: +lng }
    }
    throw new Error(`index ${i}: 잘못된 형식`)
  })
}

/* ── 공용 UI ── */
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
      minHeight: 48, WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      ...style,
    }}>{children}</button>
  )
}

function GoalRing({ label, value, goal, unit, color }) {
  const pct = Math.min(100, Math.round((value / goal) * 100))
  const r = 34, circ = 2 * Math.PI * r, dash = (pct / 100) * circ
  return (
    <div style={{ textAlign: 'center', flex: '1 1 100px' }}>
      <svg width="84" height="84" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#2e303a" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform="rotate(-90 42 42)" style={{ transition: 'stroke-dasharray .7s ease' }} />
        <text x="42" y="38" textAnchor="middle" fill="#f3f4f6" fontSize="13" fontWeight="bold">{pct}%</text>
        <text x="42" y="53" textAnchor="middle" fill="#9ca3af" fontSize="8">{value}{unit}/{goal}{unit}</text>
      </svg>
      <div style={{ color: '#9ca3af', fontSize: 11, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 14, padding: '14px 16px', flex: '1 1 130px', minWidth: 120 }}>
      <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 5 }}>{label}</div>
      <div style={{ color: color || '#c084fc', fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function ChartCard({ title, children }) {
  return (
    <div style={{ background: '#1f2028', borderRadius: 14, padding: 16, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 12 }}>{title}</div>
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

/* ════════════════ 지도 탭 ════════════════ */
function MapTab({ googleMapsKey, active }) {
  const mapRef        = useRef(null)
  const mapObj        = useRef(null)
  const bgLine        = useRef(null)
  const animLine      = useRef(null)
  const runnerMarker  = useRef(null)
  const rafId         = useRef(null)
  const progressRef   = useRef(0)
  const playingRef    = useRef(false)
  const coordsRef     = useRef([])

  const [activated,  setActivated]  = useState(false)
  const [mapLoaded,  setMapLoaded]  = useState(false)
  const [mapError,   setMapError]   = useState('')
  const [gpsInput,   setGpsInput]   = useState('')
  const [coords,     setCoords]     = useState([])
  const [routeKm,    setRouteKm]    = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [speedIdx,   setSpeedIdx]   = useState(1)
  const [showPanel,  setShowPanel]  = useState(true)
  const [parseErr,   setParseErr]   = useState('')

  // 처음 방문 시 활성화
  useEffect(() => { if (active && !activated) setActivated(true) }, [active, activated])

  // Google Maps 로드
  useEffect(() => {
    if (!googleMapsKey || !activated || mapLoaded) return
    new Loader({ apiKey: googleMapsKey, version: 'weekly' })
      .load()
      .then(() => { setMapLoaded(true); setMapError('') })
      .catch(() => setMapError('API 키가 올바르지 않거나 Maps JavaScript API가 비활성화되어 있습니다.'))
  }, [googleMapsKey, activated, mapLoaded])

  // 지도 초기화 (mapRef div가 준비된 뒤)
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapObj.current) return
    mapObj.current = new window.google.maps.Map(mapRef.current, {
      zoom: 14,
      center: { lat: 37.5665, lng: 126.9780 },
      styles: DARK_MAP_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_BOTTOM },
    })
  }, [mapLoaded])

  useEffect(() => { coordsRef.current = coords }, [coords])

  const clearMapObjects = () => {
    bgLine.current?.setMap(null);    bgLine.current = null
    animLine.current?.setMap(null);  animLine.current = null
    runnerMarker.current?.setMap(null); runnerMarker.current = null
  }

  const loadRoute = () => {
    setParseErr('')
    try {
      const pts = parseGPS(gpsInput)
      let dist = 0
      for (let i = 1; i < pts.length; i++)
        dist += haversine(pts[i-1].lat, pts[i-1].lng, pts[i].lat, pts[i].lng)
      setRouteKm(parseFloat(dist.toFixed(2)))
      setCoords(pts)
      coordsRef.current = pts

      if (!mapObj.current) { setShowPanel(false); return }

      cancelAnimationFrame(rafId.current)
      playingRef.current = false
      progressRef.current = 0
      setPlaying(false); setProgress(0)
      clearMapObjects()

      const map = mapObj.current

      // 배경 경로
      bgLine.current = new window.google.maps.Polyline({
        path: pts, geodesic: true,
        strokeColor: '#374151', strokeOpacity: 0.5, strokeWeight: 5, map,
      })

      // 애니메이션 경로
      animLine.current = new window.google.maps.Polyline({
        path: [pts[0]], geodesic: true,
        strokeColor: '#7c3aed', strokeOpacity: 1, strokeWeight: 5, map,
      })

      // 출발/도착 마커
      const circleIcon = (color) => ({
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 9, fillColor: color, fillOpacity: 1,
        strokeColor: '#ffffff', strokeWeight: 2,
      })
      new window.google.maps.Marker({ position: pts[0], map, zIndex: 5,
        icon: circleIcon('#34d399'),
        label: { text: 'S', color: '#fff', fontSize: '10px', fontWeight: 'bold' } })
      new window.google.maps.Marker({ position: pts[pts.length - 1], map, zIndex: 5,
        icon: circleIcon('#f87171'),
        label: { text: 'F', color: '#fff', fontSize: '10px', fontWeight: 'bold' } })

      // 러너 마커
      const runnerSvg = encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36"><text y="30" font-size="28">🏃</text></svg>'
      )
      runnerMarker.current = new window.google.maps.Marker({
        position: pts[0], map, zIndex: 20,
        icon: {
          url: `data:image/svg+xml;charset=UTF-8,${runnerSvg}`,
          scaledSize: new window.google.maps.Size(36, 36),
          anchor: new window.google.maps.Point(18, 18),
        },
      })

      // 경계 맞춤
      const bounds = new window.google.maps.LatLngBounds()
      pts.forEach(p => bounds.extend(p))
      map.fitBounds(bounds, { padding: 50 })

      setShowPanel(false)
    } catch (e) {
      setParseErr(e.message)
    }
  }

  /* 재생 */
  const play = () => {
    if (playingRef.current) return
    if (progressRef.current >= 1) { progressRef.current = 0; setProgress(0) }
    playingRef.current = true; setPlaying(true)
    const speed = ANIM_SPEEDS[speedIdx].value
    let lastTs = null

    const frame = (ts) => {
      if (!playingRef.current) return
      if (!lastTs) lastTs = ts
      const dt = Math.min(ts - lastTs, 50); lastTs = ts

      const total = coordsRef.current.length
      progressRef.current = Math.min(
        progressRef.current + (speed * dt) / (ANIM_SECS_1X * 1000), 1
      )
      const rawIdx = progressRef.current * (total - 1)
      const fi = Math.floor(rawIdx), frac = rawIdx - fi

      animLine.current?.setPath(coordsRef.current.slice(0, fi + 2))

      if (runnerMarker.current && fi < total - 1) {
        const a = coordsRef.current[fi], b = coordsRef.current[fi + 1]
        runnerMarker.current.setPosition({
          lat: a.lat + (b.lat - a.lat) * frac,
          lng: a.lng + (b.lng - a.lng) * frac,
        })
      }

      setProgress(progressRef.current)

      if (progressRef.current < 1) rafId.current = requestAnimationFrame(frame)
      else { playingRef.current = false; setPlaying(false) }
    }
    rafId.current = requestAnimationFrame(frame)
  }

  const pause = () => { playingRef.current = false; setPlaying(false); cancelAnimationFrame(rafId.current) }

  const reset = () => {
    pause(); progressRef.current = 0; setProgress(0)
    const c = coordsRef.current
    if (c.length) { animLine.current?.setPath([c[0]]); runnerMarker.current?.setPosition(c[0]) }
  }

  /* 진행 바 클릭으로 스크럽 */
  const scrub = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    progressRef.current = pct; setProgress(pct)
    const total = coordsRef.current.length
    const fi = Math.floor(pct * (total - 1))
    animLine.current?.setPath(coordsRef.current.slice(0, fi + 2))
    runnerMarker.current?.setPosition(coordsRef.current[fi])
  }

  const pctDone = Math.round(progress * 100)
  const kmDone  = parseFloat((progress * routeKm).toFixed(2))

  if (!activated) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100dvh - 136px)' }}>
      {!googleMapsKey ? (
        /* API 키 없음 안내 */
        <div style={{ background: '#1f2028', borderRadius: 14, padding: 28, textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🗺️</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Google Maps API 키 필요</div>
          <div style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.8 }}>
            설정 탭에서 Google Maps API 키를 입력하면<br />GPS 경로 시각화가 활성화됩니다.
          </div>
          <a href="https://console.cloud.google.com/apis/library/maps-backend.googleapis.com"
            target="_blank" rel="noreferrer"
            style={{ color: '#c084fc', fontSize: 13, marginTop: 14 }}>
            Maps JavaScript API 활성화하기 →
          </a>
        </div>
      ) : mapError ? (
        <div style={{ background: '#7f1d1d', borderRadius: 14, padding: 16, color: '#fca5a5', fontSize: 14 }}>{mapError}</div>
      ) : (
        <>
          {/* 지도 영역 */}
          <div style={{ flex: 1, position: 'relative', borderRadius: 14, overflow: 'hidden', background: '#1f2028', minHeight: 200 }}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

            {/* 진행 오버레이 */}
            {coords.length > 0 && (
              <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(22,23,29,0.88)', borderRadius: 10, padding: '7px 12px', fontSize: 13, backdropFilter: 'blur(4px)' }}>
                <span style={{ color: '#7c3aed', fontWeight: 700 }}>{kmDone}</span>
                <span style={{ color: '#6b7280' }}> / {routeKm} km</span>
                <span style={{ color: '#9ca3af', marginLeft: 8 }}>{pctDone}%</span>
              </div>
            )}

            {/* 경로 입력 토글 버튼 */}
            <button onClick={() => setShowPanel(v => !v)}
              style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(22,23,29,0.88)', border: '1px solid #4b5563', borderRadius: 10, padding: '7px 12px', color: '#c084fc', fontSize: 13, cursor: 'pointer', backdropFilter: 'blur(4px)', WebkitTapHighlightColor: 'transparent' }}>
              {showPanel ? '✕ 닫기' : '📍 경로 입력'}
            </button>

            {!mapLoaded && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', background: '#1f2028' }}>
                지도 로딩 중...
              </div>
            )}
          </div>

          {/* GPS 입력 패널 */}
          {showPanel && (
            <div style={{ background: '#1f2028', borderRadius: 14, padding: 14 }}>
              <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8 }}>
                GPS 좌표 — <code style={{ color: '#6b7280', fontSize: 11 }}>[[lat,lng], ...]</code> 또는 <code style={{ color: '#6b7280', fontSize: 11 }}>[{'{'}lat,lng{'}'},...]</code>
              </div>
              <textarea value={gpsInput} onChange={e => { setGpsInput(e.target.value); setParseErr('') }}
                rows={3}
                placeholder="[[37.5195, 126.9393], [37.5199, 126.9400], ...]"
                style={{ ...inputStyle, resize: 'vertical', fontSize: 12, fontFamily: 'monospace' }} />
              {parseErr && <div style={{ color: '#fca5a5', fontSize: 12, marginTop: 5 }}>{parseErr}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <TouchBtn onClick={() => { setGpsInput(SAMPLE_GPS); setParseErr('') }} color="#2e303a" style={{ flex: 1, fontSize: 13, padding: '10px' }}>샘플</TouchBtn>
                <TouchBtn onClick={loadRoute} disabled={!gpsInput.trim() || !mapLoaded} style={{ flex: 2, fontSize: 13, padding: '10px' }}>경로 불러오기</TouchBtn>
              </div>
            </div>
          )}

          {/* 재생 컨트롤 */}
          {coords.length > 0 && (
            <div style={{ background: '#1f2028', borderRadius: 14, padding: '12px 14px' }}>
              {/* 진행 바 */}
              <div onClick={scrub}
                style={{ background: '#2e303a', borderRadius: 4, height: 6, marginBottom: 12, cursor: 'pointer', overflow: 'hidden' }}>
                <div style={{ background: 'linear-gradient(90deg,#7c3aed,#c084fc)', height: '100%', width: `${pctDone}%`, borderRadius: 4, transition: 'width .05s linear' }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* 리셋 */}
                <button onClick={reset} style={{ background: '#2e303a', border: 'none', borderRadius: 10, width: 44, height: 44, color: '#9ca3af', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>⏮</button>

                {/* 재생 / 일시정지 */}
                <button onClick={playing ? pause : play}
                  style={{ flex: 1, background: playing ? '#5b21b6' : '#7c3aed', border: 'none', borderRadius: 12, height: 44, color: '#fff', cursor: 'pointer', fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent' }}>
                  {playing ? '⏸' : progress >= 1 ? '↺' : '▶'}
                </button>

                {/* 속도 */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {ANIM_SPEEDS.map((s, i) => (
                    <button key={i} onClick={() => setSpeedIdx(i)}
                      style={{ background: speedIdx === i ? '#5b21b6' : '#2e303a', border: 'none', borderRadius: 8, width: 36, height: 36, color: speedIdx === i ? '#fff' : '#9ca3af', cursor: 'pointer', fontSize: 12, fontWeight: 600, WebkitTapHighlightColor: 'transparent' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 경로 요약 */}
              <div style={{ display: 'flex', gap: 16, marginTop: 10, paddingTop: 10, borderTop: '1px solid #2e303a' }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>전체 거리</div>
                  <div style={{ color: '#34d399', fontWeight: 700, fontSize: 15 }}>{routeKm} km</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>좌표 수</div>
                  <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 15 }}>{coords.length}</div>
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ color: '#6b7280', fontSize: 11 }}>진행</div>
                  <div style={{ color: '#c084fc', fontWeight: 700, fontSize: 15 }}>{kmDone} km</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ════════════════ 메인 앱 ════════════════ */
export default function App() {
  const [runs,        setRuns]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState(0)
  const [showForm,    setShowForm]    = useState(false)
  const [form,        setForm]        = useState({ date: '', distance: '', pace: '', hr: '', calories: '', note: '' })
  const [saving,      setSaving]      = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(null)
  const [aiInput,     setAiInput]     = useState('')
  const [aiMessages,  setAiMessages]  = useState([])
  const [aiLoading,   setAiLoading]   = useState(false)
  const [claudeKey,   setClaudeKey]   = useState(() => localStorage.getItem('claudeKey') || '')
  const [googleMapsKey, setGoogleMapsKey] = useState(() => localStorage.getItem('googleMapsKey') || '')
  const [error,       setError]       = useState('')
  const aiEndRef = useRef(null)

  const fetchRuns = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res  = await fetch(JSONBIN_URL + '/latest', { headers: { 'X-Master-Key': API_KEY } })
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
  useEffect(() => { aiEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [aiMessages, aiLoading])

  useEffect(() => {
    const h = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      const k = e.key
      if (k === 'n' || k === 'N') setShowForm(true)
      else if (k === 'd' || k === 'D') setTab(0)
      else if (k === 'a' || k === 'A') setTab(3)
      else if (k === 'r' || k === 'R') fetchRuns()
      else if (k === 'Escape') { setShowForm(false); setSelectedIdx(null) }
      else if (k === 'ArrowDown') setSelectedIdx(i => i === null ? 0 : Math.min(i + 1, runs.length - 1))
      else if (k === 'ArrowUp')   setSelectedIdx(i => i === null ? 0 : Math.max(i - 1, 0))
      else if (k === 'Delete' && selectedIdx !== null) handleDelete(selectedIdx)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [runs.length, selectedIdx, fetchRuns])

  const handleAdd = async () => {
    if (!form.date || !form.distance) return
    setSaving(true)
    try {
      const entry = { date: form.date, distance: parseFloat(form.distance), pace: parseFloat(form.pace) || 0, hr: parseInt(form.hr) || 0, calories: parseInt(form.calories) || 0, note: form.note }
      const newRuns = [...runs, entry].sort((a, b) => a.date.localeCompare(b.date))
      await saveRuns(newRuns); setRuns(newRuns)
      setForm({ date: '', distance: '', pace: '', hr: '', calories: '', note: '' }); setShowForm(false)
    } catch { setError('저장 실패') }
    finally { setSaving(false) }
  }

  const handleDelete = async (idx) => {
    const newRuns = runs.filter((_, i) => i !== idx)
    await saveRuns(newRuns); setRuns(newRuns); setSelectedIdx(null)
  }

  /* 통계 */
  const now = new Date()
  const weekAgo    = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const weekRuns   = runs.filter(r => r.date >= weekAgo)
  const monthRuns  = runs.filter(r => r.date >= monthStart)
  const weekKm     = parseFloat(weekRuns.reduce((s, r) => s + r.distance, 0).toFixed(1))
  const monthKm    = parseFloat(monthRuns.reduce((s, r) => s + r.distance, 0).toFixed(1))
  const paceRuns   = runs.filter(r => r.pace > 0)
  const avgPace    = paceRuns.length ? paceRuns.reduce((s, r) => s + r.pace, 0) / paceRuns.length : 0
  const hrRuns     = runs.filter(r => r.hr > 0)
  const avgHr      = hrRuns.length ? Math.round(hrRuns.reduce((s, r) => s + r.hr, 0) / hrRuns.length) : 0
  const totalCal   = runs.reduce((s, r) => s + r.calories, 0)
  const recent     = runs.slice(-14)

  /* AI 코치 */
  const askAI = async () => {
    if (!aiInput.trim() || !claudeKey) return
    const userMsg  = aiInput.trim()
    const nextMsgs = [...aiMessages, { role: 'user', content: userMsg }]
    setAiMessages(nextMsgs); setAiInput(''); setAiLoading(true)
    const summary = `이번주 ${weekKm}km(${weekRuns.length}회), 이번달 ${monthKm}km(${monthRuns.length}회), 평균 페이스 ${paceToStr(avgPace)}/km, 평균 심박 ${avgHr}bpm, 총 칼로리 ${totalCal}kcal`
    try {
      const res = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: `당신은 전문 러닝 코치입니다. 사용자 데이터: ${summary}. 구체적이고 실용적인 한국어 조언을 제공하세요.`, messages: nextMsgs }),
      })
      const data = await res.json()
      setAiMessages(m => [...m, { role: 'assistant', content: data.content?.[0]?.text || '응답 없음' }])
    } catch {
      setAiMessages(m => [...m, { role: 'assistant', content: '오류. API 키를 확인해주세요.' }])
    } finally { setAiLoading(false) }
  }

  const saveClaudeKey    = k => { setClaudeKey(k);    localStorage.setItem('claudeKey', k) }
  const saveGoogleMapsKey = k => { setGoogleMapsKey(k); localStorage.setItem('googleMapsKey', k) }

  return (
    <div style={{ minHeight: '100dvh', background: '#16171d', color: '#f3f4f6', fontFamily: 'system-ui,"Segoe UI",sans-serif', display: 'flex', flexDirection: 'column', paddingBottom: 'calc(62px + env(safe-area-inset-bottom))' }}>

      {/* 헤더 */}
      <div style={{ position: 'sticky', top: 0, zIndex: 50, background: '#16171d', borderBottom: '1px solid #2e303a', padding: 'calc(env(safe-area-inset-top) + 12px) 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🏃</span>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#c084fc' }}>러닝 대시보드</span>
        </div>
        <button onClick={fetchRuns} style={{ background: 'none', border: '1px solid #2e303a', borderRadius: 8, color: '#9ca3af', padding: '7px 12px', fontSize: 14, cursor: 'pointer', minHeight: 36, WebkitTapHighlightColor: 'transparent' }}>↻</button>
      </div>

      {error && (
        <div style={{ margin: '10px 16px 0', background: '#7f1d1d', color: '#fca5a5', padding: '10px 14px', borderRadius: 10, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* 콘텐츠 */}
      <div style={{ flex: 1, padding: '14px 16px', overflowY: 'auto' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>로딩 중...</div>
        ) : (
          <>
            {/* ── 홈 ── */}
            {tab === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <TouchBtn onClick={() => setShowForm(true)} style={{ width: '100%', fontSize: 16 }}>+ 오늘 러닝 기록 추가</TouchBtn>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <StatCard label="이번주"    value={`${weekKm}km`}   sub={`${weekRuns.length}회`}  color="#34d399" />
                  <StatCard label="이번달"    value={`${monthKm}km`}  sub={`${monthRuns.length}회`} color="#60a5fa" />
                  <StatCard label="평균 페이스" value={paceToStr(avgPace)} sub="/km"              color="#f472b6" />
                  <StatCard label="평균 심박"  value={avgHr ? `${avgHr}bpm` : '-'}               color="#fb923c" />
                  <StatCard label="총 칼로리"  value={totalCal ? totalCal.toLocaleString() : '-'} sub="kcal" color="#facc15" />
                </div>
                <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 14, fontSize: 14 }}>목표 달성률</div>
                  <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                    <GoalRing label="주간 목표" value={weekKm}  goal={GOALS.weeklyKm}  unit="km" color="#34d399" />
                    <GoalRing label="월간 목표" value={monthKm} goal={GOALS.monthlyKm} unit="km" color="#60a5fa" />
                    <GoalRing label="페이스 목표" value={avgPace > 0 ? parseFloat(Math.min(GOALS.targetPace, avgPace).toFixed(2)) : 0} goal={GOALS.targetPace} unit="분" color="#f472b6" />
                  </div>
                </div>
                {recent.length > 0 && (
                  <>
                    <ChartCard title="거리 추이 (km)">
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={recent} margin={{ left: -20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                          <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                          <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} />
                          <Tooltip {...tooltipStyle} />
                          <Bar dataKey="distance" fill="#7c3aed" radius={[4,4,0,0]} name="거리(km)" />
                        </BarChart>
                      </ResponsiveContainer>
                    </ChartCard>
                    <ChartCard title="페이스 추이 (분/km)">
                      <ResponsiveContainer width="100%" height={160}>
                        <LineChart data={recent.filter(r => r.pace > 0)} margin={{ left: -10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2e303a" />
                          <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={d => d.slice(5)} />
                          <YAxis tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={paceToStr} domain={['auto','auto']} />
                          <Tooltip {...tooltipStyle} formatter={v => [paceToStr(v), '페이스']} />
                          <Line type="monotone" dataKey="pace" stroke="#f472b6" strokeWidth={2} dot={false} />
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
                            <Line type="monotone" dataKey="hr" stroke="#fb923c" strokeWidth={2} dot={false} />
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
                            <Bar dataKey="calories" fill="#facc15" radius={[4,4,0,0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartCard>
                    </div>
                  </>
                )}
                {recent.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: '#6b7280' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>🏃</div>
                    <div>아직 기록이 없습니다</div>
                  </div>
                )}
              </div>
            )}

            {/* ── 기록 ── */}
            {tab === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>전체 기록 ({runs.length}회)</span>
                  <TouchBtn onClick={() => setShowForm(true)} style={{ padding: '10px 16px', fontSize: 13 }}>+ 추가</TouchBtn>
                </div>
                {runs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>기록이 없습니다.</div>
                ) : (
                  [...runs].reverse().map((r, i) => {
                    const origIdx = runs.length - 1 - i, sel = selectedIdx === origIdx
                    return (
                      <div key={i} onClick={() => setSelectedIdx(sel ? null : origIdx)}
                        style={{ background: sel ? '#2e1f4a' : '#1f2028', borderRadius: 14, padding: '14px 16px', cursor: 'pointer', border: `1px solid ${sel ? '#7c3aed' : 'transparent'}`, transition: 'all .15s' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ color: '#9ca3af', fontSize: 13 }}>{r.date}</span>
                          <span style={{ color: '#34d399', fontWeight: 700, fontSize: 16 }}>{r.distance} km</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 13, color: '#f472b6' }}>⏱ {paceToStr(r.pace)}/km</span>
                          {r.hr > 0       && <span style={{ fontSize: 13, color: '#fb923c' }}>❤️ {r.hr}bpm</span>}
                          {r.calories > 0 && <span style={{ fontSize: 13, color: '#facc15' }}>🔥 {r.calories}kcal</span>}
                        </div>
                        {r.note && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6 }}>{r.note}</div>}
                        {sel && (
                          <div style={{ marginTop: 10 }}>
                            <TouchBtn onClick={e => { e.stopPropagation(); handleDelete(origIdx) }} color="#7f1d1d" style={{ width: '100%', fontSize: 14, padding: '10px' }}>이 기록 삭제</TouchBtn>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* ── 지도 ── */}
            <div style={{ display: tab === 2 ? 'block' : 'none' }}>
              <MapTab googleMapsKey={googleMapsKey} active={tab === 2} />
            </div>

            {/* ── AI 코치 ── */}
            {tab === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: 'calc(100dvh - 180px)' }}>
                {!claudeKey && (
                  <div style={{ background: '#1f2028', borderRadius: 14, padding: 14 }}>
                    <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 7 }}>Claude API Key</div>
                    <input type="password" placeholder="sk-ant-..." onChange={e => saveClaudeKey(e.target.value)} style={inputStyle} />
                  </div>
                )}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {aiMessages.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#6b7280', padding: '32px 0' }}>
                      <div style={{ fontSize: 36, marginBottom: 10 }}>🤖</div>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>AI 러닝 코치</div>
                      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {['이번주 훈련 평가해줘', '페이스 향상 방법', '다음 훈련 계획 세워줘'].map(q => (
                          <button key={q} onClick={() => setAiInput(q)} style={{ background: '#2e303a', border: 'none', borderRadius: 20, padding: '10px 16px', color: '#c084fc', cursor: 'pointer', fontSize: 14, WebkitTapHighlightColor: 'transparent' }}>{q}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {aiMessages.map((m, i) => (
                    <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: m.role === 'user' ? '#5b21b6' : '#2e303a', borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px', padding: '12px 16px', fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  ))}
                  {aiLoading && <div style={{ alignSelf: 'flex-start', background: '#2e303a', borderRadius: '18px 18px 18px 4px', padding: '12px 16px', color: '#9ca3af', fontSize: 14 }}>답변 생성 중...</div>}
                  <div ref={aiEndRef} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={aiInput} onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI() } }}
                    placeholder={claudeKey ? '질문 입력...' : '설정 탭에서 API 키를 입력하세요'}
                    style={{ ...inputStyle, flex: 1 }} disabled={!claudeKey} />
                  <TouchBtn onClick={askAI} disabled={!claudeKey || !aiInput.trim() || aiLoading} style={{ padding: '12px 18px', flexShrink: 0 }}>↑</TouchBtn>
                </div>
              </div>
            )}

            {/* ── 설정 ── */}
            {tab === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Claude API Key</div>
                  <input type="password" value={claudeKey} onChange={e => saveClaudeKey(e.target.value)} placeholder="sk-ant-..." style={inputStyle} />
                  <div style={{ color: '#6b7280', fontSize: 12, marginTop: 7 }}>AI 코치 기능에 사용 · 로컬 저장</div>
                  {claudeKey && <button onClick={() => saveClaudeKey('')} style={{ marginTop: 10, background: 'none', border: '1px solid #4b5563', borderRadius: 8, padding: '7px 14px', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}>키 삭제</button>}
                </div>

                <div style={{ background: '#1f2028', borderRadius: 14, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Google Maps API Key</div>
                  <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>지도 탭 GPS 경로 시각화에 사용 · Maps JavaScript API 필요</div>
                  <input type="password" value={googleMapsKey} onChange={e => saveGoogleMapsKey(e.target.value)} placeholder="AIza..." style={inputStyle} />
                  {googleMapsKey && <button onClick={() => saveGoogleMapsKey('')} style={{ marginTop: 10, background: 'none', border: '1px solid #4b5563', borderRadius: 8, padding: '7px 14px', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}>키 삭제</button>}
                </div>

                <div style={{ background: '#1f2028', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid #2e303a', fontWeight: 600 }}>⌨️ 키보드 단축키</div>
                  {SHORTCUTS.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '11px 16px', borderBottom: i < SHORTCUTS.length - 1 ? '1px solid #2e303a' : 'none' }}>
                      <kbd style={{ background: '#2e303a', border: '1px solid #4b5563', borderRadius: 6, padding: '3px 10px', fontFamily: 'monospace', fontSize: 12, color: '#c084fc', minWidth: 48, textAlign: 'center', marginRight: 14, flexShrink: 0 }}>{s.keys}</kbd>
                      <span style={{ color: '#d1d5db', fontSize: 14 }}>{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 하단 탭 바 */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: '#1f2028', borderTop: '1px solid #2e303a', display: 'flex', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '9px 4px 7px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation', minHeight: 54, position: 'relative' }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: 10, color: tab === t.id ? '#c084fc' : '#6b7280', fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>
            {tab === t.id && <span style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom) + 5px)', width: 4, height: 4, borderRadius: '50%', background: '#c084fc' }} />}
          </button>
        ))}
      </div>

      {/* 기록 추가 모달 — Bottom Sheet */}
      {showForm && (
        <div onClick={e => e.target === e.currentTarget && setShowForm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}>
          <div style={{ background: '#1f2028', borderRadius: '20px 20px 0 0', padding: '18px 20px calc(20px + env(safe-area-inset-bottom))', width: '100%', boxSizing: 'border-box', maxHeight: '90dvh', overflowY: 'auto', animation: 'slideUp .25s ease' }}>
            <div style={{ width: 40, height: 4, background: '#4b5563', borderRadius: 2, margin: '0 auto 18px' }} />
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 16 }}>러닝 기록 추가</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="날짜 *"><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inputStyle} /></FormField>
              <FormField label="거리 (km) *"><input type="number" step="0.1" min="0" placeholder="5.0" value={form.distance} onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} style={inputStyle} /></FormField>
              <div style={{ display: 'flex', gap: 10 }}>
                <FormField label="페이스 (분.초)"><input type="number" step="0.01" placeholder="5.30" value={form.pace} onChange={e => setForm(f => ({ ...f, pace: e.target.value }))} style={inputStyle} /></FormField>
                <FormField label="심박수 (bpm)"><input type="number" placeholder="150" value={form.hr} onChange={e => setForm(f => ({ ...f, hr: e.target.value }))} style={inputStyle} /></FormField>
              </div>
              <FormField label="칼로리 (kcal)"><input type="number" placeholder="400" value={form.calories} onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} style={inputStyle} /></FormField>
              <FormField label="메모"><input placeholder="코스, 컨디션 등" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} /></FormField>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <TouchBtn onClick={() => setShowForm(false)} color="#2e303a" style={{ flex: 1 }}>취소</TouchBtn>
              <TouchBtn onClick={handleAdd} disabled={saving || !form.date || !form.distance} style={{ flex: 2 }}>{saving ? '저장 중...' : '저장하기'}</TouchBtn>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }
      `}</style>
    </div>
  )
}
