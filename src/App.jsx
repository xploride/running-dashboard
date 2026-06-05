import { useState, useEffect, useCallback, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

/* ─────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────── */
const C = {
  bg:     '#000000',
  card:   '#111111',
  card2:  '#1C1C1E',
  border: '#2C2C2E',
  lime:   '#C8F549',
  orange: '#FF6B35',
  red:    '#FF453A',
  blue:   '#0A84FF',
  white:  '#FFFFFF',
  muted:  '#8E8E93',
  dim:    '#3A3A3C',
}

const TABS = [
  { id: 0, label: 'HOME',  icon: '⬤' },
  { id: 1, label: 'LOG',   icon: '≡' },
  { id: 2, label: 'MAP',   icon: '◎' },
  { id: 3, label: 'STATS', icon: '▦' },
]

const PACE_ZONES = [
  { label: '회복',  min: 7.0, max: 99,  color: C.blue,   en: 'RECOVERY' },
  { label: '편안',  min: 6.0, max: 7.0, color: '#30D158', en: 'EASY'     },
  { label: '템포',  min: 5.0, max: 6.0, color: C.lime,   en: 'TEMPO'    },
  { label: '속도',  min: 4.0, max: 5.0, color: C.orange, en: 'SPEED'    },
  { label: '전력',  min: 0,   max: 4.0, color: C.red,    en: 'MAX'      },
]

const BIN_ID      = '6a212290da38895dfe84f187'
const API_KEY     = '$2a$10$S4L4AI6Ixu.mcfT/xS3q4.37HRowJYcmydaG/Ib41bUflr2jIC.lS'
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`
const ANIM_SPEEDS = [{ label:'1×',value:1},{label:'3×',value:3},{label:'10×',value:10},{label:'30×',value:30}]
const ANIM_SECS_1X = 20
const GRAD_SEGS    = 80
const SAMPLE_GPS   = `[[37.5195,126.9393],[37.5199,126.9400],[37.5203,126.9408],[37.5207,126.9416],[37.5210,126.9424],[37.5213,126.9432],[37.5216,126.9440],[37.5219,126.9448],[37.5222,126.9456],[37.5225,126.9464],[37.5228,126.9472],[37.5231,126.9480],[37.5234,126.9487],[37.5237,126.9494],[37.5240,126.9500],[37.5243,126.9506],[37.5246,126.9511],[37.5248,126.9516],[37.5250,126.9521],[37.5252,126.9526],[37.5254,126.9531],[37.5256,126.9536],[37.5258,126.9541],[37.5260,126.9546],[37.5262,126.9551],[37.5264,126.9556],[37.5266,126.9561],[37.5268,126.9566],[37.5269,126.9571],[37.5270,126.9577]]`

/* ─────────────────────────────────────────
   UTILS
───────────────────────────────────────── */
function paceToStr(p) {
  if (!p || p <= 0) return '--\'--"'
  const m = Math.floor(p), s = Math.round((p - m) * 60)
  return `${m}'${s.toString().padStart(2,'0')}"`
}
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI/180
  const a = Math.sin((la2-la1)*r/2)**2 + Math.cos(la1*r)*Math.cos(la2*r)*Math.sin((lo2-lo1)*r/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}
function parseGPS(input) {
  const raw = JSON.parse(input.trim())
  if (!Array.isArray(raw) || raw.length < 2) throw new Error('최소 2개 이상 필요')
  return raw.map((p,i) => {
    if (Array.isArray(p) && p.length>=2) return { lat:+p[0], lng:+p[1] }
    if (p?.lat!=null) return { lat:+p.lat, lng:+(p.lng??p.longitude??p.lon) }
    throw new Error(`index ${i}: 잘못된 형식`)
  })
}
function gradColor(t) {
  const r = Math.round(48+(255-48)*t), g = Math.round(209+(214-209)*t), b = Math.round(88+(10-88)*t)
  return `rgb(${r},${g},${b})`
}
function seededRng(seed) {
  let s = seed
  return () => { s=(s*1664525+1013904223)&0xffffffff; return (s>>>0)/0xffffffff }
}
function getPaceZone(pace) {
  if (!pace||pace<=0) return null
  return PACE_ZONES.find(z => pace>=z.min && pace<z.max) || PACE_ZONES[0]
}
function formatDuration(secs) {
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`
}

// GPX 전용 파서 — 좌표 + 고도·시간·심박수 메타데이터 추출
function parseGPXFile(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('GPX 파싱 실패. 올바른 GPX 파일인지 확인하세요.')

  const nodes = doc.querySelectorAll('trkpt, wpt, rtept')
  if (nodes.length === 0) throw new Error('GPX에서 트랙 포인트를 찾을 수 없습니다.')

  const points = Array.from(nodes).map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'))
    const lng = parseFloat(pt.getAttribute('lon'))
    const ele = parseFloat(pt.querySelector('ele')?.textContent)
    const time = pt.querySelector('time')?.textContent?.trim() || null
    // 심박수: Garmin gpxtpx:hr, Polar ns3:hr, 일반 hr 등 네임스페이스 무관하게 탐색
    const hrEls = pt.getElementsByTagNameNS('*', 'hr')
    const hr = hrEls.length > 0 ? parseInt(hrEls[0].textContent) : null
    return {
      lat, lng,
      ele: isNaN(ele) ? null : ele,
      time,
      hr: hr && !isNaN(hr) && hr > 0 ? hr : null,
    }
  }).filter(p => !isNaN(p.lat) && !isNaN(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)

  if (points.length < 2) throw new Error('유효한 GPS 좌표가 2개 미만입니다.')

  // 트랙 이름
  const nameEl = doc.querySelector('trk > name, rte > name, metadata > name')
  const name = nameEl?.textContent?.trim() || null

  // 시간 범위 → 총 소요 시간
  const times = points.filter(p => p.time).map(p => new Date(p.time).getTime()).filter(t => !isNaN(t))
  const startMs = times.length ? Math.min(...times) : null
  const endMs   = times.length ? Math.max(...times) : null
  const duration = startMs && endMs ? Math.round((endMs - startMs) / 1000) : null
  const dateStr  = startMs ? new Date(startMs).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : null

  // 누적 고도 상승 (1m 노이즈 필터링)
  let elevGain = 0
  const elePts = points.filter(p => p.ele !== null)
  for (let i = 1; i < elePts.length; i++) {
    const d = elePts[i].ele - elePts[i - 1].ele
    if (d > 1) elevGain += d
  }

  // 평균 심박수
  const hrPts = points.filter(p => p.hr)
  const avgHR = hrPts.length ? Math.round(hrPts.reduce((s, p) => s + p.hr, 0) / hrPts.length) : null

  // 좌표 기반 총 거리 계산 (JSONBin에 저장될 요약 데이터용)
  let routeDist = 0
  for (let i = 1; i < points.length; i++)
    routeDist += haversine(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng)
  routeDist = parseFloat(routeDist.toFixed(2))

  // 날짜 (YYYY-MM-DD) — GPX 타임스탬프는 UTC이므로 KST(+9h) 보정 후 날짜 추출
  const firstTimeStr = points.find(p => p.time)?.time
  const KST_OFFSET = 9 * 60 * 60 * 1000
  const runDate = firstTimeStr
    ? new Date(new Date(firstTimeStr).getTime() + KST_OFFSET).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  // 페이스 (분/km): duration(sec)/60 / distance
  const runPace = duration && routeDist > 0
    ? parseFloat((duration / 60 / routeDist).toFixed(2)) : 0

  // JSONBin 저장용 요약 엔트리 (좌표 제외)
  const runEntry = {
    date:      runDate,
    distance:  routeDist,
    pace:      runPace,
    hr:        avgHR || 0,
    calories:  0,           // GPX에는 칼로리 정보 없음
    note:      name || 'GPX',
    source:    'gpx',
  }

  return {
    coords: points,         // 세션 전용 — JSONBin에 저장 금지
    meta: {
      name, dateStr, duration,
      elevGain: Math.round(elevGain),
      avgHR, routeDist,
      pointCount: points.length,
      hasElevation: elePts.length > 0,
      hasHR: hrPts.length > 0,
      runEntry,             // 저장 가능한 요약 데이터
    },
  }
}

// Apple Health export.xml → [{date,distance,pace,hr,calories,note}]
function parseAppleHealthXML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML 파싱 실패. 올바른 export.xml 파일인지 확인하세요.')
  if (!doc.querySelector('HealthData')) throw new Error('Apple Health export.xml 형식이 아닙니다.\n건강 앱 → 프로필 → 모든 건강 데이터 내보내기에서 export.xml을 사용하세요.')

  const workoutEls = doc.querySelectorAll('Workout[workoutActivityType="HKWorkoutActivityTypeRunning"]')
  if (workoutEls.length === 0) throw new Error('러닝(Running) 운동 기록을 찾을 수 없습니다.')

  const runs = Array.from(workoutEls).map(w => {
    const startDate = w.getAttribute('startDate') || ''
    const date = startDate.slice(0, 10)
    if (!date || date.length < 10) return null

    // 거리 (km 변환)
    let dist = parseFloat(w.getAttribute('totalDistance'))
    const dUnit = (w.getAttribute('totalDistanceUnit') || 'km').toLowerCase()
    if (dUnit === 'm')   dist /= 1000
    if (dUnit === 'mi')  dist *= 1.60934
    if (isNaN(dist) || dist <= 0) return null
    dist = parseFloat(dist.toFixed(2))

    // 시간(분) → 페이스(분/km)
    let dur = parseFloat(w.getAttribute('duration'))
    const tUnit = (w.getAttribute('durationUnit') || 'min').toLowerCase()
    if (tUnit === 's' || tUnit === 'sec') dur /= 60
    const pace = (dur > 0 && dist > 0) ? parseFloat((dur / dist).toFixed(2)) : 0

    // 칼로리
    let cal = Math.round(parseFloat(w.getAttribute('totalEnergyBurned')) || 0)
    if (isNaN(cal)) cal = 0

    // 평균 심박수 (WorkoutStatistics)
    const hrEl = w.querySelector('WorkoutStatistics[type="HKQuantityTypeIdentifierHeartRate"]')
    let hr = Math.round(parseFloat(hrEl?.getAttribute('average') || '0'))
    if (isNaN(hr)) hr = 0

    const source = w.getAttribute('sourceName') || 'Apple Watch'
    return { date, distance: dist, pace, hr, calories: cal, note: source }
  }).filter(Boolean)

  if (runs.length === 0) throw new Error('유효한 러닝 기록을 찾을 수 없습니다.')
  runs.sort((a, b) => a.date.localeCompare(b.date))

  const totalKm = parseFloat(runs.reduce((s, r) => s + r.distance, 0).toFixed(1))
  return {
    runs,
    total: runs.length,
    dateRange: { from: runs[0].date, to: runs[runs.length - 1].date },
    totalKm,
  }
}

// Apple Health XML · KML (GPX가 아닌 경우) → [{lat,lng}]
function parseXMLtoGPS(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('XML 파싱 오류: 올바른 XML 파일인지 확인하세요.')
  const toNum = (v) => parseFloat(v)
  const valid  = (p) => !isNaN(p.lat) && !isNaN(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180

  // ① GPX: <trkpt lat="..." lon="..."> or <wpt lat="..." lon="...">
  const trkpts = doc.querySelectorAll('trkpt, wpt, rtept')
  if (trkpts.length > 0)
    return Array.from(trkpts).map(n=>({lat:toNum(n.getAttribute('lat')),lng:toNum(n.getAttribute('lon'))})).filter(valid)

  // ② Apple Health XML: <Location latitude="..." longitude="...">
  const locs = doc.querySelectorAll('Location')
  if (locs.length > 0)
    return Array.from(locs).map(n=>({lat:toNum(n.getAttribute('latitude')),lng:toNum(n.getAttribute('longitude'))})).filter(valid)

  // ③ KML: <coordinates>lng,lat,alt ...</coordinates>
  const kmls = doc.querySelectorAll('coordinates')
  if (kmls.length > 0) {
    const pts = []
    kmls.forEach(c => c.textContent.trim().split(/\s+/).forEach(t => {
      const [lo,la] = t.split(',').map(Number)
      if (!isNaN(la)&&!isNaN(lo)) pts.push({lat:la,lng:lo})
    }))
    if (pts.length > 0) return pts.filter(valid)
  }

  throw new Error('지원 형식: GPX (.gpx), Apple Health XML, KML (.kml)')
}
function calcStreak(runs) {
  if (!runs.length) return 0
  const sorted = [...new Set(runs.map(r=>r.date))].sort().reverse()
  let streak = 0, prev = null
  for (const d of sorted) {
    const cur = new Date(d)
    if (!prev) { streak=1; prev=cur; continue }
    const diff = (prev-cur)/(1000*86400)
    if (diff===1) { streak++; prev=cur }
    else break
  }
  return streak
}

/* ─────────────────────────────────────────
   MINI ROUTE SVG
───────────────────────────────────────── */
function MiniRoute({ date, w=80, h=50 }) {
  const seed = date.split('-').reduce((a,b)=>a*31+parseInt(b),0)
  const rng  = seededRng(seed)
  const n = 14
  const pts = Array.from({length:n},(_,i) => [
    8 + (i/(n-1))*(w-16) + (rng()-0.5)*6,
    h/2 + (rng()-0.5)*(h-14)
  ])
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i=1;i<n-1;i++) {
    const mx=((pts[i][0]+pts[i+1][0])/2).toFixed(1)
    const my=((pts[i][1]+pts[i+1][1])/2).toFixed(1)
    d+=` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx} ${my}`
  }
  d+=` T${pts[n-1][0].toFixed(1)} ${pts[n-1][1].toFixed(1)}`
  const id=`gr-${seed}`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{flexShrink:0,display:'block'}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.lime}/>
          <stop offset="100%" stopColor={C.orange}/>
        </linearGradient>
      </defs>
      <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={pts[0][0]} cy={pts[0][1]} r="3" fill={C.lime}/>
      <circle cx={pts[n-1][0]} cy={pts[n-1][1]} r="3" fill={C.orange}/>
    </svg>
  )
}

/* ─────────────────────────────────────────
   MONTH HEATMAP
───────────────────────────────────────── */
function MonthHeatmap({ runs, monthOffset=0 }) {
  const ref  = new Date()
  ref.setMonth(ref.getMonth() - monthOffset)
  const year  = ref.getFullYear()
  const month = ref.getMonth()
  const label = ref.toLocaleDateString('ko-KR',{year:'numeric',month:'long'})

  const byDate = {}
  runs.forEach(r => { const d=new Date(r.date); if(d.getFullYear()===year&&d.getMonth()===month) byDate[r.date]=(byDate[r.date]||0)+r.distance })
  const maxKm = Math.max(...Object.values(byDate), 1)
  const firstDow = new Date(year,month,1).getDay()
  const daysInMonth = new Date(year,month+1,0).getDate()

  return (
    <div>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.1em',color:C.muted,textTransform:'uppercase',marginBottom:10}}>{label}</div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
        {['S','M','T','W','T','F','S'].map((d,i)=>(
          <div key={i} style={{textAlign:'center',fontSize:9,fontWeight:700,color:C.dim,paddingBottom:4,textTransform:'uppercase'}}>{d}</div>
        ))}
        {Array.from({length:firstDow}).map((_,i)=><div key={`e${i}`}/>)}
        {Array.from({length:daysInMonth}).map((_,i)=>{
          const day  = i+1
          const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
          const km   = byDate[dStr]||0
          const intensity = km/maxKm
          const isToday = dStr===new Date().toISOString().slice(0,10)
          return (
            <div key={day} style={{
              aspectRatio:'1',borderRadius:6,
              background: km>0 ? `rgba(200,245,73,${0.2+intensity*0.8})` : C.card2,
              border: isToday ? `1px solid ${C.lime}` : 'none',
              display:'flex',alignItems:'center',justifyContent:'center',
              fontSize:9,color:km>0?'#000':C.dim,fontWeight:km>0?800:400,
            }}>{day}</div>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   CELEBRATION OVERLAY
───────────────────────────────────────── */
const CONFETTI_COLORS = [C.lime, C.orange, '#fff', '#FFD60A', '#FF6B9D']
function Celebration({ run, onDone }) {
  const pieces = useRef(Array.from({length:28},(_,i)=>({
    id:i, color:CONFETTI_COLORS[i%CONFETTI_COLORS.length],
    left:`${5+Math.random()*90}%`, delay:`${Math.random()*0.8}s`,
    dur:`${1.2+Math.random()*1.2}s`, size:6+Math.random()*8,
    rot:Math.random()*360,
  }))).current

  return (
    <div style={{ position:'fixed',inset:0,zIndex:500,background:'rgba(0,0,0,0.95)', display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',overflow:'hidden' }}>
      {pieces.map(p=>(
        <div key={p.id} className="conf-piece" style={{
          '--left':p.left,'--delay':p.delay,'--dur':p.dur,'--rot':`${p.rot}deg`,
          position:'absolute',top:'-10px',left:p.left,
          width:p.size,height:p.size,background:p.color,borderRadius:p.size>10?'50%':'2px',
          animation:`confFall ${p.dur} ${p.delay} ease-in forwards`,
        }}/>
      ))}
      <div className="celeb-in" style={{textAlign:'center',padding:'0 24px'}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.3em',color:C.lime,marginBottom:12,textTransform:'uppercase'}}>
          Great Run! 🎉
        </div>
        <div style={{fontSize:88,fontWeight:900,letterSpacing:'-5px',lineHeight:1,color:C.white}}>
          {run.distance}
          <span style={{fontSize:32,letterSpacing:'-1px',color:C.muted}}> KM</span>
        </div>
        <div style={{display:'flex',justifyContent:'center',gap:24,marginTop:20}}>
          {[
            {label:'PACE', val:paceToStr(run.pace)},
            {label:'HR',   val:run.hr>0?`${run.hr}bpm`:'—'},
            {label:'CAL',  val:run.calories>0?`${run.calories}`:'—'},
          ].map(s=>(
            <div key={s.label}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.15em',color:C.muted}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:800,color:C.white}}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onDone} style={{
        marginTop:48,background:C.lime,color:'#000',border:'none',
        borderRadius:50,padding:'16px 56px',fontSize:15,fontWeight:900,
        letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',
        WebkitTapHighlightColor:'transparent',
      }}>DONE</button>
    </div>
  )
}

/* ─────────────────────────────────────────
   INPUT STYLE
───────────────────────────────────────── */
const inp = {
  width:'100%',boxSizing:'border-box',background:C.card2,border:`1px solid ${C.border}`,
  borderRadius:12,padding:'13px 16px',color:C.white,fontSize:16,outline:'none',WebkitAppearance:'none',
}

/* ─────────────────────────────────────────
   HOME TAB
───────────────────────────────────────── */
function HomeTab({ runs, onAdd }) {
  const now     = new Date()
  const weekAgo = new Date(now-7*86400000).toISOString().slice(0,10)
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`
  const weekRuns  = runs.filter(r=>r.date>=weekAgo)
  const monthRuns = runs.filter(r=>r.date>=monthStart)
  const weekKm    = weekRuns.reduce((s,r)=>s+r.distance,0)
  const monthKm   = monthRuns.reduce((s,r)=>s+r.distance,0)
  const recentRuns= [...runs].reverse().slice(0,3)
  const streak    = calcStreak(runs)
  const GOAL_KM   = 40

  const dayOfWeek = ['SUN','MON','TUE','WED','THU','FRI','SAT'][now.getDay()]
  const dateStr   = now.toLocaleDateString('ko-KR',{month:'long',day:'numeric'})

  return (
    <div style={{display:'flex',flexDirection:'column',gap:0}}>
      {/* ── 히어로 섹션 ── */}
      <div style={{padding:'8px 20px 0'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
          <div>
            <span style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.lime,textTransform:'uppercase'}}>{dayOfWeek} · {dateStr}</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {streak>0&&<div style={{background:C.card2,borderRadius:20,padding:'4px 10px',display:'flex',alignItems:'center',gap:5}}>
              <span style={{fontSize:13}}>🔥</span>
              <span style={{fontSize:12,fontWeight:800,color:C.orange}}>{streak}일 연속</span>
            </div>}
          </div>
        </div>

        {/* 주간 거리 — 대형 타이포 */}
        <div style={{marginTop:12,marginBottom:4}}>
          <div style={{fontSize:11,fontWeight:700,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:2}}>THIS WEEK</div>
          <div style={{display:'flex',alignItems:'flex-end',gap:6,lineHeight:1}}>
            <span style={{fontSize:96,fontWeight:900,letterSpacing:'-6px',color:C.white,lineHeight:0.92}}>
              {weekKm.toFixed(1)}
            </span>
            <span style={{fontSize:28,fontWeight:900,color:C.muted,marginBottom:8,letterSpacing:'-1px'}}>KM</span>
          </div>
        </div>

        {/* 목표 진행 바 */}
        <div style={{marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:'0.1em',textTransform:'uppercase'}}>Weekly Goal</span>
            <span style={{fontSize:11,fontWeight:700,color:C.lime}}>{Math.min(100,Math.round(weekKm/GOAL_KM*100))}% · {GOAL_KM}KM</span>
          </div>
          <div style={{height:4,background:C.card2,borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${Math.min(100,weekKm/GOAL_KM*100)}%`,background:`linear-gradient(90deg,${C.lime},${C.orange})`,borderRadius:2,transition:'width 1s ease'}}/>
          </div>
        </div>

        {/* 빠른 스탯 행 */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:20}}>
          {[
            {label:'RUNS',   val:weekRuns.length,  unit:''},
            {label:'MONTH',  val:monthKm.toFixed(1), unit:'km'},
            {label:'TOTAL',  val:runs.length,        unit:'runs'},
          ].map(s=>(
            <div key={s.label} style={{background:C.card,borderRadius:14,padding:'12px 14px'}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:3}}>{s.label}</div>
              <div style={{fontSize:22,fontWeight:900,color:C.white,letterSpacing:'-1px',lineHeight:1}}>{s.val}<span style={{fontSize:12,color:C.muted,fontWeight:600}}>{s.unit&&' '+s.unit}</span></div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 빠른 기록 버튼 ── */}
      <div style={{padding:'0 20px',marginBottom:24}}>
        <button onClick={onAdd} style={{
          width:'100%',background:C.lime,border:'none',borderRadius:16,
          padding:'18px',color:'#000',fontSize:16,fontWeight:900,
          letterSpacing:'0.08em',textTransform:'uppercase',cursor:'pointer',
          WebkitTapHighlightColor:'transparent',
          boxShadow:`0 0 32px rgba(200,245,73,0.25)`,
        }}>+ LOG A RUN</button>
      </div>

      {/* ── 최근 러닝 ── */}
      <div style={{padding:'0 20px'}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:12}}>RECENT RUNS</div>
        {recentRuns.length===0 && (
          <div style={{textAlign:'center',padding:'32px 0',color:C.dim,fontSize:14}}>
            아직 러닝 기록이 없습니다<br/>
            <span style={{color:C.lime,fontSize:12}}>첫 기록을 추가해보세요 →</span>
          </div>
        )}
        {recentRuns.map((r,i)=><RecentRunCard key={i} run={r}/>)}
      </div>
    </div>
  )
}

function RecentRunCard({ run }) {
  const zone = getPaceZone(run.pace)
  const dateLabel = new Date(run.date).toLocaleDateString('ko-KR',{month:'short',day:'numeric',weekday:'short'})
  return (
    <div style={{background:C.card,borderRadius:16,padding:'16px',marginBottom:10,display:'flex',alignItems:'center',gap:14}}>
      <MiniRoute date={run.date} w={72} h={48}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>{dateLabel}</div>
        <div style={{fontSize:28,fontWeight:900,letterSpacing:'-1.5px',color:C.white,lineHeight:1}}>{run.distance}<span style={{fontSize:13,fontWeight:600,color:C.muted}}> KM</span></div>
      </div>
      <div style={{textAlign:'right',flexShrink:0}}>
        <div style={{fontSize:15,fontWeight:800,color:zone?.color||C.muted}}>{paceToStr(run.pace)}</div>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'0.1em',textTransform:'uppercase'}}>/KM</div>
        {run.hr>0&&<div style={{fontSize:11,color:C.muted,marginTop:2}}>❤ {run.hr}</div>}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   RECORDS TAB (TIMELINE)
───────────────────────────────────────── */
function RecordsTab({ runs, onAdd, onDelete, gpxStore, onViewRoute }) {
  const [selectedIdx, setSelectedIdx] = useState(null)
  const sorted = [...runs].reverse()

  // 월별 그룹
  const groups = {}
  sorted.forEach((r,i) => {
    const key = r.date.slice(0,7)
    if (!groups[key]) groups[key]=[]
    groups[key].push({...r,_origIdx: runs.length-1-i})
  })

  if (sorted.length===0) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'80px 20px',gap:16}}>
      <div style={{fontSize:64}}>🏃</div>
      <div style={{fontSize:28,fontWeight:900,color:C.white,letterSpacing:'-1px'}}>NO RUNS YET</div>
      <div style={{fontSize:14,color:C.muted,textAlign:'center'}}>첫 러닝을 기록하고<br/>타임라인을 채워보세요</div>
      <button onClick={onAdd} style={{marginTop:8,background:C.lime,color:'#000',border:'none',borderRadius:50,padding:'14px 36px',fontSize:14,fontWeight:900,letterSpacing:'0.08em',textTransform:'uppercase',cursor:'pointer'}}>ADD FIRST RUN</button>
    </div>
  )

  return (
    <div style={{padding:'0 20px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:4,marginBottom:20}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase'}}>{runs.length} TOTAL RUNS</div>
        <button onClick={onAdd} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:'7px 14px',color:C.lime,fontSize:12,fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>+ ADD</button>
      </div>
      {Object.entries(groups).map(([month,monthRuns])=>(
        <div key={month} style={{marginBottom:24}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.lime,textTransform:'uppercase',marginBottom:12}}>
            {new Date(month+'-01').toLocaleDateString('ko-KR',{year:'numeric',month:'long'})}
            <span style={{color:C.dim,marginLeft:8}}>{monthRuns.reduce((s,r)=>s+r.distance,0).toFixed(1)} KM</span>
          </div>
          {monthRuns.map((r,i)=>{
            const zone = getPaceZone(r.pace)
            const sel  = selectedIdx===r._origIdx
            const dateLabel = new Date(r.date).toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'})
            return (
              <div key={i} onClick={()=>setSelectedIdx(sel?null:r._origIdx)}
                style={{display:'flex',alignItems:'stretch',marginBottom:8,gap:0}}>
                {/* 타임라인 선 */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'center',paddingRight:12,paddingTop:4}}>
                  <div style={{width:10,height:10,borderRadius:'50%',background:zone?.color||C.lime,flexShrink:0,boxShadow:`0 0 8px ${zone?.color||C.lime}66`}}/>
                  <div style={{width:1,flex:1,background:C.border,marginTop:4}}/>
                </div>
                {/* 카드 */}
                <div style={{flex:1,background:sel?'#1A1A0A':C.card,borderRadius:16,padding:'14px 16px',border:`1px solid ${sel?C.lime:C.border}`,transition:'all .15s',cursor:'pointer'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'0.12em',textTransform:'uppercase'}}>{dateLabel}</div>
                      <div style={{fontSize:32,fontWeight:900,letterSpacing:'-2px',color:C.white,lineHeight:1.1}}>{r.distance}<span style={{fontSize:13,color:C.muted,fontWeight:600}}> km</span></div>
                    </div>
                    <MiniRoute date={r.date} w={72} h={44}/>
                  </div>
                  <div style={{display:'flex',gap:14,marginTop:10,flexWrap:'wrap'}}>
                    <Chip color={zone?.color||C.muted} label="PACE" val={paceToStr(r.pace)}/>
                    {r.hr>0&&<Chip color={C.red} label="HR" val={`${r.hr}bpm`}/>}
                    {r.calories>0&&<Chip color={C.orange} label="CAL" val={`${r.calories}`}/>}
                    {zone&&<div style={{background:`${zone.color}22`,borderRadius:20,padding:'3px 10px'}}>
                      <span style={{fontSize:10,fontWeight:800,color:zone.color,letterSpacing:'0.1em'}}>{zone.en}</span>
                    </div>}
                  </div>
                  {r.note&&<div style={{color:C.muted,fontSize:12,marginTop:8,fontStyle:'italic'}}>"{r.note}"</div>}

                  {/* 경로 보기 버튼 — GPX 출처 기록이거나 세션에 좌표가 있을 때 표시 */}
                  {(r.source === 'gpx' || gpxStore?.[r.date]) && (
                    <button onClick={e=>{e.stopPropagation();onViewRoute(r.date)}}
                      style={{marginTop:10,width:'100%',background:`${C.lime}18`,border:`1px solid ${C.lime}55`,borderRadius:10,padding:'9px',color:C.lime,fontSize:12,fontWeight:800,letterSpacing:'0.08em',textTransform:'uppercase',cursor:'pointer',WebkitTapHighlightColor:'transparent',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                      <span style={{fontSize:14}}>▶</span> 경로 보기
                    </button>
                  )}

                  {sel&&<button onClick={e=>{e.stopPropagation();onDelete(r._origIdx);setSelectedIdx(null)}}
                    style={{marginTop:8,width:'100%',background:C.red+'22',border:`1px solid ${C.red}44`,borderRadius:10,padding:'10px',color:C.red,fontSize:12,fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>
                    DELETE RUN
                  </button>}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Chip({ color, label, val }) {
  return (
    <div>
      <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.12em',color:C.muted,textTransform:'uppercase'}}>{label}</div>
      <div style={{fontSize:14,fontWeight:800,color}}>{val}</div>
    </div>
  )
}

/* ─────────────────────────────────────────
   STATS TAB
───────────────────────────────────────── */
function StatsTab({ runs }) {
  const [period, setPeriod] = useState('total') // 'total' | 'monthly' | 'weekly'
  const now = new Date()

  const weekAgoStr   = new Date(now - 7*86400000).toISOString().slice(0,10)
  const monthStartStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`

  const filtered = period === 'weekly'  ? runs.filter(r => r.date >= weekAgoStr)
                 : period === 'monthly' ? runs.filter(r => r.date >= monthStartStr)
                 : runs

  const paceRuns  = filtered.filter(r => r.pace > 0)
  const avgPace   = paceRuns.length ? paceRuns.reduce((s,r) => s+r.pace, 0) / paceRuns.length : 0
  const totalKm   = filtered.reduce((s,r) => s+r.distance, 0)
  const maxSingle = filtered.reduce((max,r) => r.distance > max ? r.distance : max, 0)

  // 차트 데이터
  const chartData = period === 'weekly'
    ? Array.from({length:7}, (_, i) => {
        const d = new Date(now); d.setDate(d.getDate() - (6-i))
        const dStr = d.toISOString().slice(0,10)
        const km = runs.filter(r => r.date === dStr).reduce((s,r) => s+r.distance, 0)
        return { week: ['일','월','화','수','목','금','토'][d.getDay()], km: parseFloat(km.toFixed(1)) }
      })
    : period === 'monthly'
    ? Array.from({length: new Date(now.getFullYear(), now.getMonth()+1, 0).getDate()}, (_, i) => {
        const day  = i + 1
        const dStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
        const km   = runs.filter(r => r.date === dStr).reduce((s,r) => s+r.distance, 0)
        return { week: String(day), km: parseFloat(km.toFixed(1)) }
      })
    : Array.from({length:8}, (_, i) => {
        const end = new Date(now); end.setDate(end.getDate()-i*7)
        const start = new Date(end); start.setDate(start.getDate()-6)
        const es = end.toISOString().slice(0,10), ss = start.toISOString().slice(0,10)
        const km = runs.filter(r => r.date>=ss && r.date<=es).reduce((s,r) => s+r.distance, 0)
        return { week: `-${i}W`, km: parseFloat(km.toFixed(1)) }
      }).reverse()

  const zoneCounts   = PACE_ZONES.map(z => ({ ...z, count: paceRuns.filter(r => r.pace>=z.min && r.pace<z.max).length }))
  const maxZoneCount = Math.max(...zoneCounts.map(z => z.count), 1)

  const statLabels = { total: ['TOTAL DIST','TOTAL RUNS'], monthly: ['MONTH DIST','MONTH RUNS'], weekly: ['WEEK DIST','WEEK RUNS'] }
  const [distLabel, runsLabel] = statLabels[period]
  const chartLabel = period === 'total' ? 'WEEKLY VOLUME' : 'DAILY VOLUME'

  return (
    <div style={{display:'flex',flexDirection:'column',gap:20,padding:'0 20px'}}>
      {/* 서브탭 */}
      <div style={{display:'flex',background:C.card,borderRadius:14,padding:4,gap:4}}>
        {[['total','TOTAL'],['monthly','MONTHLY'],['weekly','WEEKLY']].map(([p,label]) => (
          <button key={p} onClick={() => setPeriod(p)} style={{
            flex:1, background: period===p ? C.lime : 'transparent', border:'none',
            borderRadius:10, padding:'10px 4px', color: period===p ? '#000' : C.muted,
            fontSize:13, fontWeight:900, letterSpacing:'0.06em', textTransform:'uppercase',
            cursor:'pointer', WebkitTapHighlightColor:'transparent', transition:'all .15s',
          }}>{label}</button>
        ))}
      </div>

      {/* 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <BigStatCard label={distLabel} val={totalKm.toFixed(1)} unit="KM" color={C.lime}/>
        <BigStatCard label={runsLabel} val={`${filtered.length}`} unit="RUNS" color={C.orange}/>
        <BigStatCard label="AVG PACE" val={paceToStr(avgPace)} unit="/KM" color="#30D158"/>
        <BigStatCard label="LONGEST RUN" val={maxSingle.toFixed(1)} unit="KM" color={C.blue}/>
      </div>

      {/* 볼륨 차트 */}
      <div style={{background:C.card,borderRadius:16,padding:'16px 14px'}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:14}}>{chartLabel}</div>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} margin={{left:-28,right:0,top:4,bottom:0}}>
            <XAxis dataKey="week" tick={{fill:C.muted,fontSize:9,fontWeight:700}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fill:C.muted,fontSize:9}} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,fontSize:12}} labelStyle={{color:C.white}} formatter={v=>[`${v} km`]}/>
            <Bar dataKey="km" radius={[6,6,0,0]}>
              {chartData.map((_,i) => <Cell key={i} fill={i===chartData.length-1 ? C.lime : C.dim}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 페이스 구간 */}
      <div style={{background:C.card,borderRadius:16,padding:'16px'}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:16}}>PACE ZONES</div>
        {zoneCounts.map((z,i) => (
          <div key={i} style={{marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:z.color}}/>
                <span style={{fontSize:11,fontWeight:800,color:C.white,letterSpacing:'0.06em'}}>{z.en}</span>
                <span style={{fontSize:10,color:C.muted}}>{z.min===0?`<${z.max}`:`${z.min}${z.max<99?`–${z.max}`:'+'}` }'</span>
              </div>
              <span style={{fontSize:12,fontWeight:800,color:z.count>0?z.color:C.dim}}>{z.count}<span style={{fontSize:10,color:C.muted,fontWeight:500}}> runs</span></span>
            </div>
            <div style={{height:5,background:C.card2,borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${(z.count/maxZoneCount)*100}%`,background:z.color,borderRadius:3,transition:'width 1s ease',opacity:z.count?1:0.3}}/>
            </div>
          </div>
        ))}
      </div>

      {/* 히트맵 — WEEKLY는 생략 */}
      {period !== 'weekly' && (
        <div style={{background:C.card,borderRadius:16,padding:'16px'}}>
          <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:14}}>ACTIVITY HEATMAP</div>
          <MonthHeatmap runs={runs} monthOffset={0}/>
          {period === 'total' && (
            <>
              <div style={{height:1,background:C.border,margin:'16px 0'}}/>
              <MonthHeatmap runs={runs} monthOffset={1}/>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function BigStatCard({ label, val, unit, color }) {
  return (
    <div style={{background:C.card,borderRadius:16,padding:'16px 14px'}}>
      <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:4}}>{label}</div>
      <div style={{fontSize:30,fontWeight:900,letterSpacing:'-1.5px',color,lineHeight:1}}>{val}</div>
      <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:'0.08em',marginTop:2}}>{unit}</div>
    </div>
  )
}

/* ─────────────────────────────────────────
   MAP TAB (Apple Health style)
───────────────────────────────────────── */
function MapTab({ active, uploadedGPS, gpxMeta, onUploadConsumed, autoPlay, onAutoPlayDone }) {
  const mapRef=useRef(null),mapObj=useRef(null),bgLineRef=useRef(null)
  const gradSegsRef=useRef([]),lastVisibleRef=useRef(-1)
  const runnerRef=useRef(null),rafId=useRef(null)
  const progressRef=useRef(0),playingRef=useRef(false),coordsRef=useRef([])
  const pendingPlayRef=useRef(false)

  const [activated,  setActivated]  = useState(false)
  const [mapReady,   setMapReady]   = useState(false)
  const [gpsInput,   setGpsInput]   = useState('')
  const [coords,     setCoords]     = useState([])
  const [routeKm,    setRouteKm]    = useState(0)
  const [playing,    setPlaying]    = useState(false)
  const [progress,   setProgress]   = useState(0)
  const [speedIdx,   setSpeedIdx]   = useState(1)
  const [showPanel,  setShowPanel]  = useState(true)
  const [parseErr,   setParseErr]   = useState('')

  useEffect(()=>{ if(active&&!activated) setActivated(true) },[active,activated])
  useEffect(()=>{
    if(!activated||!mapRef.current||mapObj.current) return
    const map=L.map(mapRef.current,{center:[37.5665,126.9780],zoom:13,zoomControl:true})
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
      attribution:'© <a href="https://openstreetmap.org" style="color:#555">OSM</a> © <a href="https://carto.com" style="color:#555">CARTO</a>',maxZoom:19
    }).addTo(map)
    mapObj.current=map
    setMapReady(true)
  },[activated])

  // GPX 업로드 시 자동 로드
  useEffect(()=>{
    if(!uploadedGPS||!mapReady) return
    if(autoPlay) pendingPlayRef.current=true
    setGpsInput(uploadedGPS)
    setParseErr('')
    loadRouteFrom(uploadedGPS)
    onUploadConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[uploadedGPS, mapReady])

  // 경로 로드 완료 후 자동 재생
  useEffect(()=>{
    if(pendingPlayRef.current && coords.length > 0){
      pendingPlayRef.current=false
      onAutoPlayDone?.()
      setTimeout(()=>play(), 600)  // 지도 렌더링 후 재생
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[coords])

  useEffect(()=>{ if(active&&mapObj.current) setTimeout(()=>mapObj.current.invalidateSize(),50) },[active])
  useEffect(()=>{ coordsRef.current=coords },[coords])

  const clearLayers=()=>{
    bgLineRef.current?.remove(); bgLineRef.current=null
    gradSegsRef.current.forEach(s=>s.remove()); gradSegsRef.current=[]; lastVisibleRef.current=-1
    runnerRef.current?.remove(); runnerRef.current=null
  }
  const showSegsUpTo=(n)=>{
    const segs=gradSegsRef.current,last=lastVisibleRef.current
    if(n>last){ for(let i=last+1;i<=Math.min(n,segs.length-1);i++) segs[i].setStyle({opacity:1}); lastVisibleRef.current=Math.min(n,segs.length-1) }
    else if(n<last){ for(let i=n+1;i<=last;i++) segs[i].setStyle({opacity:0}); lastVisibleRef.current=n }
  }
  const loadRouteFrom=(inputStr)=>{
    setParseErr('')
    try {
      const pts=parseGPS(inputStr)
      let dist=0; for(let i=1;i<pts.length;i++) dist+=haversine(pts[i-1].lat,pts[i-1].lng,pts[i].lat,pts[i].lng)
      setRouteKm(parseFloat(dist.toFixed(2))); setCoords(pts); coordsRef.current=pts
      cancelAnimationFrame(rafId.current); playingRef.current=false; progressRef.current=0
      setPlaying(false); setProgress(0); clearLayers()
      const map=mapObj.current,lls=pts.map(p=>[p.lat,p.lng]),n=pts.length
      bgLineRef.current=L.polyline(lls,{color:'#ffffff',weight:4,opacity:0.12,lineCap:'round',lineJoin:'round'}).addTo(map)
      const segs=Math.min(GRAD_SEGS,n-1)
      for(let i=0;i<segs;i++){
        const si=Math.floor(i*(n-1)/segs),ei=Math.floor((i+1)*(n-1)/segs)+1
        const seg=L.polyline(pts.slice(si,Math.min(ei,n)).map(p=>[p.lat,p.lng]),{color:gradColor(i/(segs-1)),weight:6,opacity:0,lineCap:'round',lineJoin:'round',smoothFactor:0}).addTo(map)
        gradSegsRef.current.push(seg)
      }
      const ci=(c,gl)=>L.divIcon({html:`<div style="width:18px;height:18px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 10px 3px ${c}88;"></div>`,className:'',iconSize:[18,18],iconAnchor:[9,9]})
      L.marker(lls[0],{icon:ci('#30D158'),zIndexOffset:100}).addTo(map)
      L.marker(lls[n-1],{icon:ci('#FF453A'),zIndexOffset:100}).addTo(map)
      runnerRef.current=L.marker(lls[0],{icon:L.divIcon({html:`<div class="rp-wrap"><div class="rp-ring rp-r1"></div><div class="rp-ring rp-r2"></div><div class="rp-ring rp-r3"></div><div class="rp-core"></div></div>`,className:'',iconSize:[40,40],iconAnchor:[20,20]}),zIndexOffset:1000}).addTo(map)
      map.fitBounds(L.latLngBounds(lls),{padding:[48,48]}); setShowPanel(false)
    } catch(e){ setParseErr(e.message) }
  }
  const play=()=>{
    if(playingRef.current) return
    if(progressRef.current>=1){ progressRef.current=0; setProgress(0); showSegsUpTo(-1) }
    playingRef.current=true; setPlaying(true)
    const speed=ANIM_SPEEDS[speedIdx].value; let lastTs=null
    const frame=(ts)=>{
      if(!playingRef.current) return
      if(!lastTs) lastTs=ts
      const dt=Math.min(ts-lastTs,50); lastTs=ts
      const total=coordsRef.current.length
      progressRef.current=Math.min(progressRef.current+(speed*dt)/(ANIM_SECS_1X*1000),1)
      const rawIdx=progressRef.current*(total-1),fi=Math.floor(rawIdx),frac=rawIdx-fi
      if(fi<total-1){ const a=coordsRef.current[fi],b=coordsRef.current[fi+1]; runnerRef.current?.setLatLng([a.lat+(b.lat-a.lat)*frac,a.lng+(b.lng-a.lng)*frac]) }
      showSegsUpTo(Math.floor(progressRef.current*(gradSegsRef.current.length-1)))
      setProgress(progressRef.current)
      if(progressRef.current<1) rafId.current=requestAnimationFrame(frame)
      else { playingRef.current=false; setPlaying(false) }
    }
    rafId.current=requestAnimationFrame(frame)
  }
  const pause=()=>{ playingRef.current=false; setPlaying(false); cancelAnimationFrame(rafId.current) }
  const reset=()=>{
    pause(); progressRef.current=0; setProgress(0); showSegsUpTo(-1)
    const c=coordsRef.current; if(c.length) runnerRef.current?.setLatLng([c[0].lat,c[0].lng])
  }
  const scrub=(e)=>{
    const rect=e.currentTarget.getBoundingClientRect(),pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))
    progressRef.current=pct; setProgress(pct)
    const total=coordsRef.current.length; if(!total||!mapObj.current) return
    const fi=Math.min(Math.floor(pct*(total-1)),total-2)
    showSegsUpTo(Math.floor(pct*(gradSegsRef.current.length-1)))
    runnerRef.current?.setLatLng([coordsRef.current[fi].lat,coordsRef.current[fi].lng])
  }
  const pctDone=Math.round(progress*100),kmDone=parseFloat((progress*routeKm).toFixed(2))
  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,height:'calc(100dvh - 136px)',padding:'0 16px'}}>
      <div style={{flex:1,position:'relative',borderRadius:16,overflow:'hidden',minHeight:220}}>
        <div ref={mapRef} style={{width:'100%',height:'100%'}}/>
        {coords.length>0&&<div style={{position:'absolute',top:12,left:12,background:'rgba(0,0,0,0.7)',borderRadius:12,padding:'8px 14px',fontSize:13,backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',gap:6}}>
          <span style={{color:gradColor(progress),fontWeight:800,fontSize:15}}>{kmDone}</span>
          <span style={{color:'rgba(255,255,255,0.4)',fontSize:12}}>/ {routeKm} km</span>
        </div>}
        <button onClick={()=>setShowPanel(v=>!v)} style={{position:'absolute',top:12,right:12,background:'rgba(0,0,0,0.7)',border:'none',borderRadius:12,padding:'8px 14px',color:C.lime,fontSize:13,fontWeight:700,cursor:'pointer',backdropFilter:'blur(8px)',zIndex:1000,WebkitTapHighlightColor:'transparent'}}>{showPanel?'✕':'📍 경로 입력'}</button>
      </div>
      {showPanel&&<div style={{background:C.card,borderRadius:14,padding:14}}>
        <div style={{fontSize:11,color:C.muted,marginBottom:8,fontWeight:700}}>GPS 좌표 — [[lat,lng], ...] 또는 [{'{'}lat,lng{'}'},...]</div>
        <textarea value={gpsInput} onChange={e=>{setGpsInput(e.target.value);setParseErr('')}} rows={3} placeholder="[[37.5195, 126.9393], ...]" style={{...inp,resize:'vertical',fontSize:12,fontFamily:'monospace'}}/>
        {parseErr&&<div style={{color:C.red,fontSize:12,marginTop:5}}>{parseErr}</div>}
        <div style={{display:'flex',gap:8,marginTop:10}}>
          <button onClick={()=>{setGpsInput(SAMPLE_GPS);setParseErr('')}} style={{flex:1,background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:'10px',color:C.muted,fontSize:13,fontWeight:700,cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>샘플</button>
          <button onClick={()=>loadRouteFrom(gpsInput)} disabled={!gpsInput.trim()} style={{flex:2,background:C.lime,border:'none',borderRadius:10,padding:'10px',color:'#000',fontSize:13,fontWeight:900,cursor:'pointer',opacity:gpsInput.trim()?1:0.5,WebkitTapHighlightColor:'transparent'}}>경로 불러오기</button>
        </div>
      </div>}
      {coords.length>0&&<div style={{background:C.card,borderRadius:14,padding:'12px 14px'}}>
        <div onClick={scrub} style={{background:C.card2,borderRadius:4,height:5,marginBottom:12,cursor:'pointer',overflow:'hidden'}}>
          <div style={{background:`linear-gradient(90deg,#30D158,#FFD60A)`,height:'100%',width:`${pctDone}%`,borderRadius:4,transition:'width .05s linear'}}/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={reset} style={{background:C.card2,border:'none',borderRadius:10,width:44,height:44,color:C.muted,cursor:'pointer',fontSize:18,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,WebkitTapHighlightColor:'transparent'}}>⏮</button>
          <button onClick={playing?pause:play} style={{flex:1,background:playing?'#1c7a38':'#30D158',border:'none',borderRadius:12,height:44,color:'#000',cursor:'pointer',fontSize:22,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',WebkitTapHighlightColor:'transparent'}}>{playing?'⏸':progress>=1?'↺':'▶'}</button>
          <div style={{display:'flex',gap:4,flexShrink:0}}>
            {ANIM_SPEEDS.map((s,i)=><button key={i} onClick={()=>setSpeedIdx(i)} style={{background:speedIdx===i?'#30D158':C.card2,border:'none',borderRadius:8,width:36,height:36,color:speedIdx===i?'#000':C.muted,cursor:'pointer',fontSize:12,fontWeight:800,WebkitTapHighlightColor:'transparent'}}>{s.label}</button>)}
          </div>
        </div>
        {/* 기본 경로 요약 */}
        <div style={{display:'flex',marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
          {[{l:'TOTAL',v:`${routeKm} km`,c:'#30D158'},{l:'PTS',v:`${coords.length}`,c:C.blue},{l:'DONE',v:`${kmDone} km`,c:'#FFD60A'}].map(s=>(
            <div key={s.l} style={{flex:1,textAlign:'center'}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase'}}>{s.l}</div>
              <div style={{fontSize:15,fontWeight:900,color:s.c,letterSpacing:'-0.5px'}}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>}

      {/* GPX 메타데이터 카드 */}
      {gpxMeta && coords.length > 0 && (
        <div style={{background:C.card,borderRadius:14,padding:'14px 16px',border:`1px solid ${C.lime}33`}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:900,color:C.white,letterSpacing:'-0.3px'}}>
              {gpxMeta.name || 'GPX 경로'}
            </div>
            <div style={{fontSize:10,fontWeight:700,color:C.lime,letterSpacing:'0.12em',textTransform:'uppercase',background:`${C.lime}18`,borderRadius:20,padding:'3px 9px'}}>GPX</div>
          </div>
          <div style={{display:'flex',flexWrap:'wrap',gap:14}}>
            {gpxMeta.dateStr && (
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>DATE</div>
                <div style={{fontSize:13,fontWeight:700,color:C.white}}>{gpxMeta.dateStr}</div>
              </div>
            )}
            {gpxMeta.duration && (
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>TIME</div>
                <div style={{fontSize:13,fontWeight:700,color:C.white}}>{formatDuration(gpxMeta.duration)}</div>
              </div>
            )}
            {gpxMeta.hasElevation && gpxMeta.elevGain > 0 && (
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>ELEV ↑</div>
                <div style={{fontSize:13,fontWeight:700,color:'#30D158'}}>{gpxMeta.elevGain}m</div>
              </div>
            )}
            {gpxMeta.hasHR && gpxMeta.avgHR && (
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>AVG HR</div>
                <div style={{fontSize:13,fontWeight:700,color:C.red}}>❤ {gpxMeta.avgHR}bpm</div>
              </div>
            )}
            <div>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>POINTS</div>
              <div style={{fontSize:13,fontWeight:700,color:C.muted}}>{gpxMeta.pointCount.toLocaleString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────
   ADD RUN MODAL
───────────────────────────────────────── */
function AddRunModal({ onSave, onClose }) {
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0,10), distance:'', pace:'', hr:'', calories:'', note:'' })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!form.date||!form.distance) return
    setSaving(true)
    const entry = { date:form.date, distance:parseFloat(form.distance), pace:parseFloat(form.pace)||0, hr:parseInt(form.hr)||0, calories:parseInt(form.calories)||0, note:form.note }
    await onSave(entry)
    setSaving(false)
  }

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:200,display:'flex',alignItems:'flex-end'}}>
      <div style={{background:'#111',borderRadius:'24px 24px 0 0',padding:'20px 20px calc(20px + env(safe-area-inset-bottom))',width:'100%',boxSizing:'border-box',maxHeight:'90dvh',overflowY:'auto',animation:'slideUp .25s ease'}}>
        <div style={{width:40,height:4,background:C.border,borderRadius:2,margin:'0 auto 20px'}}/>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.lime,textTransform:'uppercase',marginBottom:20}}>LOG A RUN</div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {[
            {label:'DATE *', key:'date', type:'date'},
          ].map(f=>(
            <div key={f.key}>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>{f.label}</div>
              <input type={f.type} value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))} style={inp}/>
            </div>
          ))}
          <div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>DISTANCE (KM) *</div>
            <input type="number" step="0.01" min="0" placeholder="5.00" value={form.distance} onChange={e=>setForm(p=>({...p,distance:e.target.value}))} style={inp}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>PACE</div>
              <input type="number" step="0.01" placeholder="5.30" value={form.pace} onChange={e=>setForm(p=>({...p,pace:e.target.value}))} style={inp}/>
            </div>
            <div>
              <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>HEART RATE</div>
              <input type="number" placeholder="150" value={form.hr} onChange={e=>setForm(p=>({...p,hr:e.target.value}))} style={inp}/>
            </div>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>CALORIES</div>
            <input type="number" placeholder="400" value={form.calories} onChange={e=>setForm(p=>({...p,calories:e.target.value}))} style={inp}/>
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:6}}>NOTE</div>
            <input placeholder="코스, 컨디션..." value={form.note} onChange={e=>setForm(p=>({...p,note:e.target.value}))} style={inp}/>
          </div>
        </div>
        <div style={{display:'flex',gap:10,marginTop:20}}>
          <button onClick={onClose} style={{flex:1,background:C.card2,border:`1px solid ${C.border}`,borderRadius:14,padding:'16px',color:C.muted,fontSize:14,fontWeight:800,letterSpacing:'0.06em',textTransform:'uppercase',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}>CANCEL</button>
          <button onClick={handleSave} disabled={saving||!form.date||!form.distance} style={{flex:2,background:C.lime,border:'none',borderRadius:14,padding:'16px',color:'#000',fontSize:14,fontWeight:900,letterSpacing:'0.08em',textTransform:'uppercase',cursor:'pointer',opacity:(saving||!form.date||!form.distance)?0.5:1,WebkitTapHighlightColor:'transparent'}}>
            {saving?'SAVING...':'SAVE RUN'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   SETTINGS TAB
───────────────────────────────────────── */
function SettingsTab({ onImportRuns, onGPXLoad }) {
  const [claudeKey,     setClaudeKey]     = useState(()=>localStorage.getItem('claudeKey')||'')
  const [healthPreview, setHealthPreview] = useState(null)   // {runs,total,dateRange,totalKm}
  const [gpxPreview,    setGpxPreview]    = useState(null)   // {coords,meta}
  const [importing,     setImporting]     = useState(false)
  const [importResult,  setImportResult]  = useState(null)   // {added,total,type}
  const [fileError,     setFileError]     = useState('')
  const [parsing,       setParsing]       = useState(false)

  const healthRef = useRef(null)
  const gpxRef    = useRef(null)

  const saveKey = k => { setClaudeKey(k); localStorage.setItem('claudeKey', k) }

  /* Apple Health XML 선택 */
  const handleHealthFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileError(''); setHealthPreview(null); setImportResult(null); setParsing(true)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try   { setHealthPreview(parseAppleHealthXML(evt.target.result)) }
      catch (err) { setFileError(err.message) }
      finally     { setParsing(false) }
    }
    reader.onerror = () => { setFileError('파일 읽기 실패'); setParsing(false) }
    reader.readAsText(file, 'UTF-8')
    e.target.value = ''
  }

  /* GPX 파일 선택 — 파싱 후 미리보기 표시 (좌표는 세션 전용) */
  const handleGPXFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileError(''); setGpxPreview(null); setImportResult(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try   { setGpxPreview(parseGPXFile(evt.target.result)) }
      catch (err) { setFileError(err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  /* GPX 저장 + 지도 표시 */
  const confirmGPXSave = async (sendToMap) => {
    if (!gpxPreview) return
    setImporting(true)
    try {
      let added = 0
      if (sendToMap) onGPXLoad(gpxPreview.coords, gpxPreview.meta)
      // 요약 데이터만 JSONBin에 저장 (coords 포함 안 됨)
      added = await onImportRuns([gpxPreview.meta.runEntry])
      setImportResult({ added, total: 1, type: 'gpx' })
      setGpxPreview(null)
    } catch (err) { setFileError(err.message) }
    finally { setImporting(false) }
  }

  /* 가져오기 확인 */
  const confirmImport = async () => {
    if (!healthPreview) return
    setImporting(true)
    try {
      const added = await onImportRuns(healthPreview.runs)
      setImportResult({ added, total: healthPreview.total })
      setHealthPreview(null)
    } catch (err) { setFileError(err.message) }
    finally { setImporting(false) }
  }

  const sBtn = (bg='#C8F549', fg='#000') => ({
    width:'100%', background:bg, border:'none', borderRadius:12,
    padding:'13px 16px', color:fg, fontSize:12, fontWeight:900,
    cursor:'pointer', WebkitTapHighlightColor:'transparent',
    letterSpacing:'0.06em', textTransform:'uppercase',
  })

  return (
    <div style={{padding:'0 20px',display:'flex',flexDirection:'column',gap:16}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',marginBottom:4}}>SETTINGS</div>

      {/* ── Apple Health XML 가져오기 ── */}
      <div style={{background:C.card,borderRadius:16,padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
          <span style={{fontSize:18}}>🍎</span>
          <span style={{fontSize:14,fontWeight:900,color:C.white}}>Apple Health 가져오기</span>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.7}}>
          건강 앱 → 프로필 아이콘 → 모든 건강 데이터 내보내기<br/>
          압축 해제 후 <code style={{color:C.lime,fontSize:11}}>export.xml</code> 파일을 선택하면<br/>
          모든 러닝 기록을 대시보드로 자동 가져옵니다.
        </div>
        <input ref={healthRef} type="file" accept=".xml" onChange={handleHealthFile} style={{display:'none'}}/>
        <button onClick={()=>{setFileError('');setImportResult(null);healthRef.current?.click()}}
          disabled={parsing}
          style={sBtn(parsing ? C.card2 : C.lime, parsing ? C.muted : '#000')}>
          {parsing ? '⏳ 파싱 중...' : '📂 export.xml 선택'}
        </button>

        {fileError && (
          <div style={{marginTop:10,background:`${C.red}18`,borderRadius:10,padding:'10px 14px',color:C.red,fontSize:12,lineHeight:1.6,whiteSpace:'pre-wrap'}}>
            {fileError}
          </div>
        )}

        {/* 미리보기 카드 */}
        {healthPreview && (
          <div style={{marginTop:14,background:C.card2,borderRadius:12,padding:14}}>
            <div style={{fontSize:13,fontWeight:900,color:C.lime,marginBottom:12}}>
              🏃 {healthPreview.total.toLocaleString()}개 러닝 기록 발견
            </div>
            <div style={{display:'flex',gap:20,marginBottom:12,flexWrap:'wrap'}}>
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>기간</div>
                <div style={{fontSize:12,fontWeight:700,color:C.white}}>{healthPreview.dateRange.from}<br/> ~ {healthPreview.dateRange.to}</div>
              </div>
              <div>
                <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>총 거리</div>
                <div style={{fontSize:20,fontWeight:900,color:C.lime,letterSpacing:'-1px'}}>{healthPreview.totalKm} <span style={{fontSize:11,color:C.muted}}>km</span></div>
              </div>
            </div>

            {/* 최근 5개 미리보기 */}
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase',marginBottom:8}}>최근 기록 미리보기</div>
              {healthPreview.runs.slice(-5).reverse().map((r,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:11,color:C.muted}}>{r.date}</span>
                  <span style={{fontSize:13,fontWeight:800,color:C.white}}>{r.distance}km</span>
                  <span style={{fontSize:12,fontWeight:700,color:C.lime}}>{paceToStr(r.pace)}/km</span>
                  {r.hr>0&&<span style={{fontSize:11,color:C.red}}>❤ {r.hr}</span>}
                </div>
              ))}
              {healthPreview.total > 5 && (
                <div style={{fontSize:11,color:C.dim,textAlign:'center',paddingTop:8}}>... 외 {healthPreview.total-5}개</div>
              )}
            </div>

            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setHealthPreview(null)}
                style={{...sBtn(C.card,C.muted),flex:1,border:`1px solid ${C.border}`}}>취소</button>
              <button onClick={confirmImport} disabled={importing}
                style={{...sBtn('#30D158','#000'),flex:2,opacity:importing?0.7:1}}>
                {importing ? '저장 중...' : `${healthPreview.total.toLocaleString()}개 가져오기`}
              </button>
            </div>
          </div>
        )}

        {importResult && (
          <div style={{marginTop:12,background:'#30D15820',border:'1px solid #30D15840',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:14,fontWeight:900,color:'#30D158'}}>✅ 가져오기 완료</div>
            <div style={{fontSize:12,color:C.muted,marginTop:4}}>
              {importResult.added}개 새 기록 추가
              {importResult.total - importResult.added > 0 &&
                ` · ${importResult.total - importResult.added}개는 이미 존재`}
            </div>
          </div>
        )}
      </div>

      {/* ── GPX 파일 업로드 ── */}
      <div style={{background:C.card,borderRadius:16,padding:16}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
          <span style={{fontSize:18}}>🗺️</span>
          <span style={{fontSize:14,fontWeight:900,color:C.white}}>GPX 파일 가져오기</span>
        </div>
        <div style={{fontSize:12,color:C.muted,marginBottom:14,lineHeight:1.7}}>
          Apple Watch 내보내기 압축 해제 →{' '}
          <code style={{color:C.lime,fontSize:11}}>workout-routes/*.gpx</code><br/>
          브라우저에서 파싱 후 <strong style={{color:C.white}}>요약 통계만 JSONBin에 저장</strong>합니다.<br/>
          GPS 좌표는 저장하지 않고 지도 표시에만 사용됩니다.
        </div>

        <input ref={gpxRef} type="file" accept=".gpx" onChange={handleGPXFile} style={{display:'none'}}/>
        <button onClick={()=>{setFileError('');setGpxPreview(null);setImportResult(null);gpxRef.current?.click()}}
          style={sBtn()}>
          📍 GPX 파일 선택
        </button>

        {/* GPX 미리보기 */}
        {gpxPreview && (
          <div style={{marginTop:14,background:C.card2,borderRadius:12,padding:14}}>
            <div style={{fontSize:13,fontWeight:900,color:C.lime,marginBottom:12}}>
              📍 {gpxPreview.meta.name || 'GPX 경로'}
            </div>

            {/* 요약 통계 (저장될 데이터) */}
            <div style={{background:C.card,borderRadius:10,padding:'10px 12px',marginBottom:12}}>
              <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.15em',color:C.lime,textTransform:'uppercase',marginBottom:8}}>
                JSONBin에 저장될 요약 데이터
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:14}}>
                {[
                  { l:'DATE',   v: gpxPreview.meta.runEntry.date,                      c: C.white  },
                  { l:'DIST',   v: `${gpxPreview.meta.runEntry.distance} km`,           c: C.lime   },
                  { l:'PACE',   v: paceToStr(gpxPreview.meta.runEntry.pace) + '/km',    c: '#30D158'},
                  { l:'HR',     v: gpxPreview.meta.avgHR ? `${gpxPreview.meta.avgHR} bpm` : '—',  c: C.red   },
                  gpxPreview.meta.duration && { l:'TIME', v: formatDuration(gpxPreview.meta.duration), c: C.orange },
                  gpxPreview.meta.elevGain > 0 && { l:'ELEV↑', v: `${gpxPreview.meta.elevGain}m`, c: C.blue },
                ].filter(Boolean).map(s => (
                  <div key={s.l}>
                    <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:C.muted,textTransform:'uppercase'}}>{s.l}</div>
                    <div style={{fontSize:14,fontWeight:800,color:s.c}}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 세션 전용 안내 */}
            <div style={{display:'flex',alignItems:'flex-start',gap:8,background:`${C.blue}15`,borderRadius:10,padding:'8px 12px',marginBottom:12}}>
              <span style={{fontSize:14,flexShrink:0}}>ℹ️</span>
              <div style={{fontSize:11,color:C.muted,lineHeight:1.6}}>
                GPS 좌표 ({gpxPreview.meta.pointCount.toLocaleString()}개) 는 JSONBin에 저장되지 않습니다.
                지도 표시는 현재 세션에서만 유지됩니다.
              </div>
            </div>

            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setGpxPreview(null)}
                style={{...sBtn(C.card, C.muted), flex:1, border:`1px solid ${C.border}`}}>취소</button>
              <button
                onClick={()=>{ onGPXLoad(gpxPreview.coords, gpxPreview.meta); setGpxPreview(null) }}
                style={{...sBtn(C.card2, C.white), flex:1, border:`1px solid ${C.border}`}}>
                지도만 보기
              </button>
              <button onClick={()=>confirmGPXSave(true)} disabled={importing}
                style={{...sBtn(), flex:2, opacity: importing ? 0.7 : 1}}>
                {importing ? '저장 중...' : '저장 + 지도'}
              </button>
            </div>
          </div>
        )}

        {importResult?.type === 'gpx' && (
          <div style={{marginTop:12,background:'#30D15820',border:'1px solid #30D15840',borderRadius:10,padding:'12px 14px'}}>
            <div style={{fontSize:13,fontWeight:900,color:'#30D158'}}>
              {importResult.added > 0 ? '✅ 통계 저장 완료' : '⚠️ 이미 존재하는 기록'}
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>
              {importResult.added > 0
                ? 'JSONBin에 요약 데이터가 저장됐습니다. GPS 좌표는 저장되지 않았습니다.'
                : '같은 날짜·거리 기록이 이미 존재합니다.'}
            </div>
          </div>
        )}
      </div>

      {/* ── Claude API Key ── */}
      <div style={{background:C.card,borderRadius:16,padding:16}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:4}}>CLAUDE API KEY</div>
        <div style={{fontSize:12,color:C.dim,marginBottom:10}}>AI 코치 기능에 사용 · 로컬 저장</div>
        <input type="password" value={claudeKey} onChange={e=>saveKey(e.target.value)} placeholder="sk-ant-..." style={inp}/>
        {claudeKey&&<button onClick={()=>saveKey('')} style={{marginTop:10,background:'none',border:`1px solid ${C.border}`,borderRadius:8,padding:'7px 14px',color:C.muted,cursor:'pointer',fontSize:12,fontWeight:700,WebkitTapHighlightColor:'transparent'}}>REMOVE KEY</button>}
      </div>

      {/* ── 앱 정보 ── */}
      <div style={{background:C.card,borderRadius:16,padding:16}}>
        <div style={{fontSize:10,fontWeight:800,letterSpacing:'0.15em',color:C.muted,textTransform:'uppercase',marginBottom:10}}>ABOUT</div>
        <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:13}}>
          {[['App','Running Dashboard'],['Version','2.1.0'],['Data','JSONBin'],['Map','Leaflet + OSM'],['AI','Claude Sonnet 4.6']].map(([k,v])=>(
            <div key={k} style={{display:'flex',justifyContent:'space-between'}}>
              <span style={{color:C.muted}}>{k}</span>
              <span style={{color:C.white,fontWeight:700}}>{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────
   MAIN APP
───────────────────────────────────────── */
export default function App() {
  const [runs,        setRuns]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [tab,         setTab]         = useState(0)
  const [showAdd,     setShowAdd]     = useState(false)
  const [celebRun,    setCelebRun]    = useState(null)
  const [error,       setError]       = useState('')
  const [uploadedGPS, setUploadedGPS] = useState(null)
  const [gpxMeta,     setGpxMeta]     = useState(null)
  const [gpxStore,    setGpxStore]    = useState({})   // { 'YYYY-MM-DD': {coords, meta} } — 세션 전용
  const [autoPlay,    setAutoPlay]    = useState(false)
  const fileInputRef = useRef(null)

  // GPX를 세션 스토어에 저장하는 헬퍼
  const storeGPX = (coords, meta) => {
    const date = meta.runEntry?.date
    if (date) setGpxStore(prev => ({ ...prev, [date]: { coords, meta } }))
    setUploadedGPS(JSON.stringify(coords.map(p => [p.lat, p.lng])))
    setGpxMeta(meta)
  }

  const handleGPXUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const isGPX = /\.(gpx)$/i.test(file.name)
        if (isGPX) {
          const { coords, meta } = parseGPXFile(evt.target.result)
          storeGPX(coords, meta)
        } else {
          const pts = parseXMLtoGPS(evt.target.result)
          if (pts.length < 2) throw new Error('좌표가 2개 미만입니다.')
          setUploadedGPS(JSON.stringify(pts.map(p => [p.lat, p.lng])))
          setGpxMeta(null)
        }
        setTab(2)
        setError('')
      } catch (err) { setError(err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const fetchRuns = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res  = await fetch(JSONBIN_URL+'/latest',{headers:{'X-Master-Key':API_KEY}})
      const data = await res.json()
      setRuns(data.record?.runs||[])
    } catch { setError('데이터 로드 실패') }
    finally { setLoading(false) }
  },[])

  const saveRuns = async (newRuns) => {
    const res = await fetch(JSONBIN_URL,{method:'PUT',headers:{'Content-Type':'application/json','X-Master-Key':API_KEY},body:JSON.stringify({runs:newRuns})})
    if(!res.ok) throw new Error('저장 실패')
  }

  useEffect(()=>{ fetchRuns() },[fetchRuns])

  const handleAdd = async (entry) => {
    const newRuns = [...runs,entry].sort((a,b)=>a.date.localeCompare(b.date))
    await saveRuns(newRuns)
    setRuns(newRuns)
    setShowAdd(false)
    setCelebRun(entry)
  }

  const handleDelete = async (idx) => {
    const newRuns = runs.filter((_,i)=>i!==idx)
    await saveRuns(newRuns); setRuns(newRuns)
  }

  // Apple Health import — 중복 제거(날짜+거리 반올림 키) 후 병합
  const handleImportRuns = async (importedRuns) => {
    const existing = new Set(runs.map(r=>`${r.date}_${Math.round(r.distance*10)}`))
    const newOnly  = importedRuns.filter(r=>!existing.has(`${r.date}_${Math.round(r.distance*10)}`))
    const merged   = [...runs, ...newOnly].sort((a,b)=>a.date.localeCompare(b.date))
    await saveRuns(merged)
    setRuns(merged)
    return newOnly.length
  }

  // 설정 탭에서 GPX 업로드
  const handleGPXFromSettings = (coords, meta) => {
    storeGPX(coords, meta)
    setTab(2)
  }

  // LOG 탭 "경로 보기" — gpxStore에서 날짜 매칭 후 MAP 탭으로 이동
  const handleViewRoute = (date) => {
    const gpx = gpxStore[date]
    if (!gpx) return
    storeGPX(gpx.coords, gpx.meta)
    setAutoPlay(true)
    setTab(2)
  }

  return (
    <div style={{minHeight:'100dvh',background:C.bg,color:C.white,fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif',display:'flex',flexDirection:'column',paddingBottom:'calc(62px + env(safe-area-inset-bottom))'}}>

      {/* 헤더 */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(0,0,0,0.9)',backdropFilter:'blur(20px)',borderBottom:`1px solid ${C.border}`,padding:'calc(env(safe-area-inset-top) + 12px) 20px 12px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{fontSize:18,fontWeight:900,letterSpacing:'-0.5px',color:C.white}}>RUNNING</div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {error&&<div style={{fontSize:11,color:C.red,fontWeight:700,maxWidth:140,textOverflow:'ellipsis',overflow:'hidden',whiteSpace:'nowrap'}} title={error}>{error}</div>}
          {/* GPX / XML 업로드 */}
          <input ref={fileInputRef} type="file" accept=".gpx,.xml,.kml" onChange={handleGPXUpload} style={{display:'none'}}/>
          <button onClick={()=>fileInputRef.current?.click()} style={{background:'none',border:`1px solid ${C.lime}44`,borderRadius:20,padding:'5px 12px',color:C.lime,fontSize:11,fontWeight:800,cursor:'pointer',WebkitTapHighlightColor:'transparent',letterSpacing:'0.1em',display:'flex',alignItems:'center',gap:4}}>
            <span style={{fontSize:13}}>↑</span>GPX
          </button>
          <button onClick={fetchRuns} style={{background:'none',border:`1px solid ${C.border}`,borderRadius:20,padding:'5px 12px',color:C.muted,fontSize:12,fontWeight:700,cursor:'pointer',WebkitTapHighlightColor:'transparent',letterSpacing:'0.06em'}}>↻</button>
        </div>
      </div>

      {/* 콘텐츠 */}
      <div style={{flex:1,overflowY:'auto',paddingTop:16}}>
        {loading ? (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'80px 20px',gap:16}}>
            <div style={{fontSize:14,fontWeight:800,letterSpacing:'0.18em',color:C.muted,textTransform:'uppercase',animation:'pulse 1.5s ease infinite'}}>LOADING...</div>
          </div>
        ) : (
          <>
            {tab===0&&<HomeTab runs={runs} onAdd={()=>setShowAdd(true)}/>}
            {tab===1&&<RecordsTab runs={runs} onAdd={()=>setShowAdd(true)} onDelete={handleDelete} gpxStore={gpxStore} onViewRoute={handleViewRoute}/>}
            <div style={{display:tab===2?'block':'none'}}><MapTab active={tab===2} uploadedGPS={uploadedGPS} gpxMeta={gpxMeta} onUploadConsumed={()=>setUploadedGPS(null)} autoPlay={autoPlay} onAutoPlayDone={()=>setAutoPlay(false)}/></div>
            {tab===3&&<StatsTab runs={runs}/>}
            {tab===5&&<SettingsTab onImportRuns={handleImportRuns} onGPXLoad={handleGPXFromSettings}/>}
          </>
        )}
      </div>

      {/* 하단 탭 바 */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:100,background:'rgba(0,0,0,0.95)',backdropFilter:'blur(20px)',borderTop:`1px solid ${C.border}`,display:'flex',paddingBottom:'env(safe-area-inset-bottom)'}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 4px 8px',display:'flex',flexDirection:'column',alignItems:'center',gap:3,WebkitTapHighlightColor:'transparent',touchAction:'manipulation',minHeight:56,position:'relative'}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:tab===t.id?C.lime:'transparent',marginBottom:2,transition:'all .2s'}}/>
            <span style={{fontSize:14,fontWeight:800,letterSpacing:'0.06em',color:tab===t.id?C.lime:C.muted,textTransform:'uppercase'}}>{t.label}</span>
          </button>
        ))}
        {/* 설정 탭 */}
        <button onClick={()=>setTab(5)} style={{flex:1,background:'none',border:'none',cursor:'pointer',padding:'10px 4px 8px',display:'flex',flexDirection:'column',alignItems:'center',gap:3,WebkitTapHighlightColor:'transparent',touchAction:'manipulation',minHeight:56,position:'relative'}}>
          <div style={{width:6,height:6,borderRadius:'50%',background:tab===5?C.lime:'transparent',marginBottom:2}}/>
          <span style={{fontSize:14,fontWeight:800,letterSpacing:'0.06em',color:tab===5?C.lime:C.muted,textTransform:'uppercase'}}>SET</span>
        </button>
      </div>

      {/* 기록 추가 모달 */}
      {showAdd&&<AddRunModal onSave={handleAdd} onClose={()=>setShowAdd(false)}/>}

      {/* 축하 오버레이 */}
      {celebRun&&<Celebration run={celebRun} onDone={()=>setCelebRun(null)}/>}

      <style>{`
        @keyframes slideUp   { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes confFall  { 0% { transform: translateY(0) rotate(0deg); opacity:1 } 100% { transform: translateY(110vh) rotate(720deg); opacity:0 } }
        @keyframes celeb-in  { 0% { transform: scale(.8) translateY(20px); opacity:0 } 100% { transform: scale(1) translateY(0); opacity:1 } }
        @keyframes pulse     { 0%,100% { opacity:.4 } 50% { opacity:1 } }
        .celeb-in { animation: celeb-in .6s cubic-bezier(.34,1.56,.64,1) both }

        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        input[type="number"] { -moz-appearance: textfield; }
        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; }

        .leaflet-container { font-family: inherit; background: #0a0a0a; }
        .leaflet-control-attribution { font-size:9px !important; background:rgba(0,0,0,0.5) !important; color:#444 !important; }
        .leaflet-control-attribution a { color:#444 !important; }
        .leaflet-control-zoom a { background:rgba(0,0,0,0.8) !important; color:#fff !important; border-color:#333 !important; }

        .rp-wrap  { position:relative; width:40px; height:40px; }
        .rp-core  { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:14px; height:14px; background:#fff; border-radius:50%; box-shadow:0 0 0 3px rgba(255,255,255,.3), 0 0 16px 4px rgba(255,255,255,.6); z-index:3; }
        .rp-ring  { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) scale(0); border-radius:50%; background:rgba(255,255,255,.35); animation:rpPulse 2s ease-out infinite; width:36px; height:36px; }
        .rp-r1    { animation-delay:0s }
        .rp-r2    { animation-delay:.65s }
        .rp-r3    { animation-delay:1.3s }
        @keyframes rpPulse {
          0%   { transform:translate(-50%,-50%) scale(.3); opacity:.8 }
          100% { transform:translate(-50%,-50%) scale(1.6); opacity:0 }
        }
      `}</style>
    </div>
  )
}
