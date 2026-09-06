import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowRight, Bot, CalendarDays, ChevronRight, CirclePlus,
  Flame, Footprints, Gauge, HeartPulse, Home, Import, LoaderCircle,
  Map as MapIcon, MessageCircle, RefreshCw, Route, Settings, Sparkles,
  Trash2, Upload, X, Zap,
} from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { askCoach, getRuns, putRuns } from './lib/api'
import { authorizeHealthKit, isNativeHealthAvailable, saveRunToHealth } from './lib/healthkit'
import {
  durationText, loadSessionRoutes, localDateKey, mergeRuns, normalizeRun,
  paceText, parseAppleHealth, parseGpx, saveSessionRoutes, weeklyDistance,
} from './lib/runData'
import './App.css'

const MAP_RELOAD_KEY = 'running-map-chunk-reload'
const RunMap = lazy(async () => {
  try {
    const module = await import('./components/RunMap')
    sessionStorage.removeItem(MAP_RELOAD_KEY)
    return module
  } catch (error) {
    if (!sessionStorage.getItem(MAP_RELOAD_KEY)) {
      sessionStorage.setItem(MAP_RELOAD_KEY, '1')
      window.location.reload()
      return new Promise(() => {})
    }
    sessionStorage.removeItem(MAP_RELOAD_KEY)
    throw error
  }
})

const WEEK_GOAL = 40
const TABS = [
  { id: 'home', label: 'Today', icon: Home },
  { id: 'log', label: 'Runs', icon: Footprints },
  { id: 'map', label: 'Route', icon: MapIcon },
  { id: 'insights', label: 'Insights', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function formatDate(date, options = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('ko-KR', options).format(new Date(`${date}T12:00:00`))
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    reader.readAsText(file)
  })
}

function useRunStats(runs) {
  return useMemo(() => {
    const total = runs.reduce((sum, run) => sum + run.distance, 0)
    const monthKey = localDateKey().slice(0, 7)
    const monthDistance = runs.filter((run) => run.date.startsWith(monthKey)).reduce((sum, run) => sum + run.distance, 0)
    const paced = runs.filter((run) => run.pace > 0)
    const averagePace = paced.length ? paced.reduce((sum, run) => sum + run.pace, 0) / paced.length : 0
    return { total, monthDistance, averagePace, weekDistance: weeklyDistance(runs) }
  }, [runs])
}

function Metric({ label, value, unit, tone = '' }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong>{unit && <small>{unit}</small>}</div>
}

function RouteSketch({ coords }) {
  if (!coords?.length) return <div className="route-sketch route-sketch--empty"><Route size={20} /></div>
  const xs = coords.map((point) => point.lng), ys = coords.map((point) => point.lat)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const width = maxX - minX || 1, height = maxY - minY || 1
  const step = Math.max(1, Math.floor(coords.length / 70))
  const sampled = coords.filter((_, index) => index % step === 0 || index === coords.length - 1)
  const points = sampled.map((point) => `${8 + ((point.lng - minX) / width) * 104},${54 - ((point.lat - minY) / height) * 46}`).join(' ')
  return <svg className="route-sketch" viewBox="0 0 120 62" role="img" aria-label="러닝 경로 미리보기"><defs><linearGradient id="sketch-gradient"><stop stopColor="#b8ff34"/><stop offset="1" stopColor="#ff6838"/></linearGradient></defs><polyline points={points} fill="none" stroke="url(#sketch-gradient)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function EmptyState({ title, text }) {
  return <div className="empty-state"><Footprints size={28}/><strong>{title}</strong><p>{text}</p></div>
}

function HomeView({ runs, routes, onAdd, onRoute }) {
  const stats = useRunStats(runs)
  const recent = [...runs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
  const goal = Math.min(100, (stats.weekDistance / WEEK_GOAL) * 100)
  return <div className="view home-view">
    <section className="home-hero">
      <div className="home-hero__top"><div><p className="eyebrow">THIS WEEK</p><h1>이번 주 러닝</h1></div><span className="streak"><Flame size={15} fill="currentColor"/> {runs.filter((run)=>weeklyDistance([run])>0).length} RUNS</span></div>
      <div className="distance-display"><strong>{stats.weekDistance.toFixed(1)}</strong><span>KM</span></div>
      <div className="goal-row"><span>{goal.toFixed(0)}% OF {WEEK_GOAL} KM</span><span>{Math.max(0, WEEK_GOAL - stats.weekDistance).toFixed(1)} TO GO</span></div>
      <div className="goal-track"><span style={{ width: `${goal}%` }}/></div>
    </section>
    <section className="quick-grid"><Metric label="THIS MONTH" value={stats.monthDistance.toFixed(1)} unit="KM"/><Metric label="AVG PACE" value={paceText(stats.averagePace)} unit="/KM" tone="metric--lime"/><Metric label="ALL TIME" value={stats.total.toFixed(0)} unit="KM"/></section>
    <button className="primary-action" onClick={onAdd}><CirclePlus size={21}/> LOG A RUN <ArrowRight size={19}/></button>
    <section className="section-block">
      <div className="section-heading"><div><p className="eyebrow">LATEST EFFORTS</p><h2>최근 러닝</h2></div><span>{runs.length} TOTAL</span></div>
      {recent.length ? <div className="recent-list">{recent.map((run) => <button key={run.id} className="recent-run" onClick={() => onRoute(run.date)}><RouteSketch coords={routes[run.date]?.coords}/><div className="recent-run__body"><span>{formatDate(run.date, { month:'long',day:'numeric',weekday:'short' })}</span><strong>{run.distance.toFixed(2)} KM</strong><small>{paceText(run.pace)} /KM · {durationText(run.duration)}</small></div><ChevronRight size={20}/></button>)}</div> : <EmptyState title="첫 러닝을 기록하세요" text="수동 입력하거나 GPX와 Apple 건강 기록을 가져올 수 있습니다."/>}
    </section>
  </div>
}

function RunsView({ runs, routes, onAdd, onDelete, onRoute, onAttachRoute, nativeHealth, onHealthSave }) {
  const sorted = [...runs].sort((a, b) => b.date.localeCompare(a.date))
  return <div className="view">
    <header className="view-title"><div><p className="eyebrow">TRAINING LOG</p><h1>러닝 기록</h1><span>날짜별 기록과 경로를 관리하세요.</span></div><button className="round-action" onClick={onAdd} aria-label="러닝 추가"><CirclePlus/></button></header>
    {sorted.length ? <div className="timeline">{sorted.map((run) => {
      const route = routes[run.date]
      return <article className="run-row" key={run.id}>
        <div className="timeline-date"><strong>{run.date.slice(8)}</strong><span>{Number(run.date.slice(5,7))}월</span></div>
        <div className="timeline-line"><span/><i/></div>
        <div className="run-card">
          <div className="run-card__top"><div><span className="source-tag">{run.source || 'RUN'}</span><h3>{run.note || 'Outdoor run'}</h3></div><RouteSketch coords={route?.coords}/></div>
          <div className="run-card__metrics"><Metric label="DISTANCE" value={run.distance.toFixed(2)} unit="KM" tone="metric--large"/><Metric label="PACE" value={paceText(run.pace)} unit="/KM"/><Metric label="TIME" value={durationText(run.duration)}/></div>
          <div className="run-card__footer"><div className="run-meta"><span><HeartPulse size={14}/> {run.hr || '--'}</span><span><Zap size={14}/> {run.calories || '--'} KCAL</span></div><div className="run-actions"><button onClick={() => route ? onRoute(run.date) : onAttachRoute(run)}><Route size={15}/> {route ? '경로 보기' : run.source==='gpx' ? '경로 복원' : 'GPX 연결'}</button>{nativeHealth&&<button className="health-action" onClick={()=>onHealthSave(run)}><HeartPulse size={15}/> 건강 저장</button>}<button className="danger-icon" onClick={() => onDelete(run)} aria-label="기록 삭제"><Trash2 size={16}/></button></div></div>
        </div>
      </article>
    })}</div> : <EmptyState title="기록이 없습니다" text="첫 러닝을 추가하면 시간순으로 정리됩니다."/>}
  </div>
}

function Heatmap({ runs }) {
  const totals = runs.reduce((map, run) => ({ ...map, [run.date]:(map[run.date] || 0) + run.distance }), {})
  const days = Array.from({ length:70 }, (_, offset) => { const date = new Date(); date.setDate(date.getDate() - (69 - offset)); const key=localDateKey(date),distance=totals[key]||0; return {key,distance,level:distance===0?0:distance<5?1:distance<10?2:distance<16?3:4} })
  return <div className="heatmap" aria-label="최근 10주 러닝 히트맵">{days.map((day)=><span key={day.key} data-level={day.level} title={`${day.key}: ${day.distance.toFixed(1)}km`}/>)}</div>
}

function localCoach(runs) {
  if (!runs.length) return '첫 주는 속도보다 습관이 중요합니다. 20~30분 편안한 러닝 3회부터 시작하세요.'
  const recent=[...runs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),avg=recent.reduce((sum,run)=>sum+run.distance,0)/recent.length
  const fast=recent.filter((run)=>run.pace>0).sort((a,b)=>a.pace-b.pace)[0]
  return `최근 ${recent.length}회 평균은 ${avg.toFixed(1)}km입니다. 다음 러닝은 ${Math.max(3,avg*.8).toFixed(1)}km를 편안하게 달리고, 마지막 5분만 리듬을 올려보세요.${fast?` 최근 최고 페이스는 ${paceText(fast.pace)}/km입니다.`:''}`
}

function InsightsView({ runs }) {
  const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[asking,setAsking]=useState(false)
  const stats=useRunStats(runs)
  const chart=[...runs].sort((a,b)=>a.date.localeCompare(b.date)).filter((run)=>run.pace>0).slice(-12).map((run)=>({date:run.date.slice(5),pace:Number(run.pace.toFixed(2))}))
  const zones=[{label:'RECOVERY',min:6.5,color:'#6f7780'},{label:'EASY',min:5.7,color:'#44d681'},{label:'TEMPO',min:4.8,color:'#ffe24a'},{label:'SPEED',min:0,color:'#ff6838'}].map((zone,index,all)=>({...zone,count:runs.filter((run)=>run.pace>=zone.min&&(index===0||run.pace<all[index-1].min)).length}))
  const maxZone=Math.max(1,...zones.map((zone)=>zone.count))
  const submit=async()=>{if(!question.trim())return;setAsking(true);const result=await askCoach(question,runs);setAnswer(result.answer||localCoach(runs));setAsking(false)}
  return <div className="view">
    <header className="view-title"><div><p className="eyebrow">TRAIN SMARTER</p><h1>러닝 분석</h1><span>페이스와 꾸준함의 흐름을 확인하세요.</span></div><Sparkles className="title-icon"/></header>
    <section className="insight-band"><p className="eyebrow">10 WEEK CONSISTENCY</p><Heatmap runs={runs}/></section>
    <section className="insight-grid"><Metric label="MONTH" value={stats.monthDistance.toFixed(1)} unit="KM" tone="metric--large"/><Metric label="AVERAGE" value={paceText(stats.averagePace)} unit="/KM" tone="metric--lime"/></section>
    <section className="chart-section"><div className="section-heading"><div><p className="eyebrow">PACE TREND</p><h2>Faster goes up</h2></div></div><div className="pace-chart"><ResponsiveContainer width="100%" height="100%" initialDimension={{width:500,height:190}}><AreaChart data={chart} margin={{top:16,right:4,left:-28,bottom:0}}><defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b8ff34" stopOpacity=".35"/><stop offset="1" stopColor="#b8ff34" stopOpacity="0"/></linearGradient></defs><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill:'#70757d',fontSize:10}}/><YAxis reversed domain={['dataMin - 0.3','dataMax + 0.3']} axisLine={false} tickLine={false} tick={{fill:'#70757d',fontSize:10}} tickFormatter={paceText}/><Tooltip contentStyle={{background:'#17191c',border:'1px solid #2b2e33',borderRadius:10}} formatter={(value)=>[`${paceText(value)}/km`,'Pace']}/><Area type="monotone" dataKey="pace" stroke="#b8ff34" strokeWidth={3} fill="url(#paceFill)"/></AreaChart></ResponsiveContainer></div></section>
    <section className="zone-section"><div className="section-heading"><div><p className="eyebrow">INTENSITY MIX</p><h2>Pace zones</h2></div></div>{zones.map((zone)=><div className="zone-row" key={zone.label}><span>{zone.label}</span><div><i style={{width:`${(zone.count/maxZone)*100}%`,background:zone.color}}/></div><strong>{zone.count}</strong></div>)}</section>
    <section className="coach-panel"><div className="coach-panel__title"><Bot size={22}/><div><p className="eyebrow">RUN COACH</p><h2>Ask one useful question.</h2></div></div><p className="coach-answer">{answer||localCoach(runs)}</p><div className="coach-input"><input value={question} onChange={(event)=>setQuestion(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&submit()} placeholder="이번 주 훈련을 어떻게 구성할까?"/><button onClick={submit} disabled={asking}>{asking?<LoaderCircle className="spin"/>:<ArrowRight/>}</button></div></section>
  </div>
}

function SettingsView({ onHealthImport, onGpxImport, syncing, nativeHealth, onHealthAuthorize }) {
  const healthRef=useRef(null),gpxRef=useRef(null)
  return <div className="view">
    <header className="view-title"><div><p className="eyebrow">CONTROL CENTER</p><h1>설정 및 연결</h1><span>데이터 가져오기와 기기 연결을 관리하세요.</span></div></header>
    <section className="settings-list"><button onClick={()=>healthRef.current?.click()}><span className="settings-icon"><HeartPulse/></span><span><strong>Apple 건강 가져오기</strong><small>export.xml · 러닝 요약만 저장</small></span><Upload/></button><input ref={healthRef} hidden type="file" accept=".xml,text/xml,application/xml" onChange={onHealthImport}/><button onClick={()=>gpxRef.current?.click()}><span className="settings-icon"><Route/></span><span><strong>GPX 경로 연결</strong><small>좌표는 현재 브라우저 세션에만 보관</small></span><Upload/></button><input ref={gpxRef} hidden type="file" onChange={onGpxImport}/></section>
    <section className="privacy-band"><span><Gauge/></span><div><p className="eyebrow">PRIVACY BY DESIGN</p><h2>경로는 기기에만.</h2><p>JSONBin에는 날짜, 거리, 시간, 페이스, 심박수, 칼로리 같은 요약만 저장합니다. GPS 좌표는 탭을 닫으면 사라집니다.</p></div></section>
    <section className="native-band"><span><CalendarDays/></span><div><p className="eyebrow">APPLE HEALTHKIT</p><h2>{nativeHealth?'Apple 건강 연결':'iOS 앱 준비 완료'}</h2><p>{nativeHealth?'건강 접근을 허용하면 러닝 기록과 연결된 경로를 Apple 건강에 저장할 수 있습니다.':'웹에서는 건강 데이터에 직접 쓸 수 없습니다. iMac에서 서명을 마친 iOS 앱에서 이 기능이 자동 활성화됩니다.'}</p><button disabled={!nativeHealth||syncing} onClick={onHealthAuthorize}><Import size={16}/>{syncing?'SYNCING':nativeHealth?'건강 접근 허용':'AVAILABLE IN IOS APP'}</button></div></section>
    <div className="app-meta"><span>RUNNING / V3</span><span>MAPLIBRE + OPENFREEMAP</span><span>PWA READY</span></div>
  </div>
}

function MapView({ runs, routes, activeRoute, activeRouteDate, autoPlay, onSelect, onAttach, onImport }) {
  const sorted=[...runs].sort((a,b)=>b.date.localeCompare(a.date))
  return <div className="map-view">
    <div className="map-toolbar"><div><p className="eyebrow">ROUTE MAP</p><strong>{activeRoute?'경로 재생':'러닝 경로'}</strong></div><button onClick={onImport}><Upload size={16}/> GPX 가져오기</button></div>
    <Suspense fallback={<div className="loading-state"><LoaderCircle className="spin"/><span>LOADING MAP</span></div>}><RunMap route={activeRoute} autoPlay={autoPlay}/></Suspense>
    {!activeRoute&&<div className="map-empty-panel"><Route size={21}/><div><strong>표시할 경로가 없습니다</strong><span>아래 기록을 눌러 GPX를 연결하면 즉시 지도에 표시됩니다.</span></div></div>}
    <div className="route-strip">{sorted.map((run)=>{const hasRoute=Boolean(routes[run.date]);return <button key={run.id} className={activeRouteDate===run.date?'active':''} onClick={()=>hasRoute?onSelect(run.date):onAttach(run)}><span>{formatDate(run.date)} · {hasRoute?'경로 있음':'복원 필요'}</span><strong>{run.distance.toFixed(1)} KM</strong></button>})}</div>
  </div>
}

function AddRunSheet({ onClose, onSave }) {
  const [form,setForm]=useState({date:localDateKey(),distance:'',duration:'',hr:'',calories:'',note:''})
  const update=(key)=>(event)=>setForm((value)=>({...value,[key]:event.target.value}))
  const submit=(event)=>{event.preventDefault();const distance=Number(form.distance),minutes=Number(form.duration);if(!distance||!minutes)return;onSave(normalizeRun({...form,id:`manual-${Date.now()}`,distance,duration:minutes*60,pace:minutes/distance,hr:Number(form.hr),calories:Number(form.calories),source:'manual'}))}
  return <div className="sheet-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&onClose()}><form className="sheet" onSubmit={submit}><div className="sheet-handle"/><div className="sheet-title"><div><p className="eyebrow">NEW ACTIVITY</p><h2>Log your run</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div><div className="form-grid"><label>DATE<input type="date" value={form.date} onChange={update('date')}/></label><label>DISTANCE · KM<input inputMode="decimal" value={form.distance} onChange={update('distance')} placeholder="8.20"/></label><label>DURATION · MIN<input inputMode="decimal" value={form.duration} onChange={update('duration')} placeholder="48"/></label><label>AVG HEART RATE<input inputMode="numeric" value={form.hr} onChange={update('hr')} placeholder="148"/></label><label>CALORIES<input inputMode="numeric" value={form.calories} onChange={update('calories')} placeholder="520"/></label><label>RUN NAME<input value={form.note} onChange={update('note')} placeholder="Evening tempo"/></label></div><button className="primary-action" type="submit">SAVE RUN <ArrowRight/></button></form></div>
}

function Celebration({ run, onClose }) {
  return <div className="celebration"><div className="celebration-ring"/><Sparkles/><p className="eyebrow">ACTIVITY SAVED</p><h2>STRONG<br/>WORK.</h2><strong>{run.distance.toFixed(2)} KM</strong><span>{durationText(run.duration)} · {paceText(run.pace)} /KM</span><button onClick={onClose}>KEEP MOVING <ArrowRight/></button></div>
}

export default function App() {
  const [runs,setRuns]=useState([]),[routes,setRoutes]=useState(loadSessionRoutes),[tab,setTab]=useState('home')
  const [activeRouteDate,setActiveRouteDate]=useState(()=>Object.keys(loadSessionRoutes()).sort().at(-1)||null),[routeVersion,setRouteVersion]=useState(0),[autoPlay,setAutoPlay]=useState(false)
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState('')
  const [showAdd,setShowAdd]=useState(false),[celebration,setCelebration]=useState(null)
  const nativeHealth=isNativeHealthAvailable()
  const attachInputRef=useRef(null),attachRunRef=useRef(null),mapInputRef=useRef(null)
  const notify=(message)=>{setToast(message);window.setTimeout(()=>setToast(''),2800)}

  const load=async()=>{setLoading(true);setError('');try{setRuns((await getRuns()).map(normalizeRun))}catch(loadError){setError(loadError.message)}finally{setLoading(false)}}
  useEffect(()=>{
    let active=true
    getRuns().then((items)=>{if(active)setRuns(items.map(normalizeRun))}).catch((loadError)=>{if(active)setError(loadError.message)}).finally(()=>{if(active)setLoading(false)})
    return()=>{active=false}
  },[])
  const persist=async(nextRuns)=>{setSaving(true);try{await putRuns(nextRuns);setRuns(nextRuns)}finally{setSaving(false)}}
  const saveRun=async(run)=>{const result=mergeRuns(runs,[run]);await persist(result.runs);setShowAdd(false);setCelebration(run)}
  const removeRun=async(run)=>{if(!window.confirm(`${run.date} · ${run.distance.toFixed(2)}km 기록을 삭제할까요?`))return;await persist(runs.filter((item)=>item.id!==run.id))}
  const storeRoute=(run,coords)=>{const next={...routes,[run.date]:{id:`${run.date}-${Date.now()}`,run,coords}};setRoutes(next);saveSessionRoutes(next);setActiveRouteDate(run.date)}
  const importGpxFile=async(file,expectedRun=null)=>{const parsed=parseGpx(await readFile(file),file.name);if(expectedRun&&parsed.run.date!==expectedRun.date){const dayGap=Math.abs((new Date(`${parsed.run.date}T12:00:00`)-new Date(`${expectedRun.date}T12:00:00`))/86400000);const distanceGap=Math.abs(parsed.run.distance-expectedRun.distance);if(dayGap>1||distanceGap>Math.max(.25,expectedRun.distance*.05))throw new Error(`GPX 날짜(${parsed.run.date})와 기록 날짜(${expectedRun.date})가 일치하지 않습니다.`)}const matchedRun=expectedRun||parsed.run;storeRoute(matchedRun,parsed.coords);if(!expectedRun){const merged=mergeRuns(runs,[parsed.run]);if(merged.added)await persist(merged.runs)}setError('');setRouteVersion((value)=>value+1);setAutoPlay(Boolean(expectedRun));setTab('map');notify(expectedRun?'경로를 연결했습니다.':'GPX 기록과 경로를 불러왔습니다.')}
  const handleGpxImport=async(event)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{await importGpxFile(file)}catch(importError){setError(importError.message)}}
  const handleHealthImport=async(event)=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setSaving(true);try{const imported=parseAppleHealth(await readFile(file));const merged=mergeRuns(runs,imported);await putRuns(merged.runs);setRuns(merged.runs);notify(`${merged.added}개의 러닝을 가져왔습니다.`)}catch(importError){setError(importError.message)}finally{setSaving(false)}}
  const attachRoute=(run)=>{attachRunRef.current=run;attachInputRef.current?.click()}
  const handleAttach=async(event)=>{const file=event.target.files?.[0];event.target.value='';if(!file||!attachRunRef.current)return;try{await importGpxFile(file,attachRunRef.current)}catch(attachError){setError(attachError.message)}finally{attachRunRef.current=null}}
  const showRoute=(date)=>{setError('');setActiveRouteDate(date);setRouteVersion((value)=>value+1);setAutoPlay(true);setTab('map')}
  const authorizeHealth=async()=>{setSaving(true);setError('');try{const result=await authorizeHealthKit();if(!result.authorized)throw new Error('Apple 건강 접근이 허용되지 않았습니다.');notify('Apple 건강 연결을 허용했습니다.')}catch(healthError){setError(healthError.message)}finally{setSaving(false)}}
  const saveHealthRun=async(run)=>{setSaving(true);setError('');try{const result=await authorizeHealthKit();if(!result.authorized)throw new Error('Apple 건강 접근이 허용되지 않았습니다.');await saveRunToHealth(run,routes[run.date]?.coords||[]);notify(`${run.date} 러닝을 Apple 건강에 저장했습니다.`)}catch(healthError){setError(healthError.message)}finally{setSaving(false)}}
  const activeRoute=activeRouteDate&&routes[activeRouteDate]?{...routes[activeRouteDate],id:`${routes[activeRouteDate].id}-${routeVersion}`}:null
  return <div className="app-shell">
    <aside className="side-rail"><div className="brand-mark"><span>R</span><strong>RUNNING</strong></div><nav>{TABS.map(({id,label,icon:Icon})=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon/><span>{label}</span></button>)}</nav><small>MOVE WITH INTENT.</small></aside>
    <div className="app-main"><header className="topbar"><div className="mobile-brand">RUNNING<span>/03</span></div><div className="topbar-status"><span className={saving?'syncing':''}>{saving?'SYNCING':'SYNCED'}</span><button className="icon-button" onClick={load} aria-label="새로고침"><RefreshCw size={18}/></button></div></header>{error&&<div className="error-banner"><span>{error}</span><button onClick={()=>setError('')}><X size={16}/></button></div>}<main>{loading?<div className="loading-state"><LoaderCircle className="spin"/><span>LOADING YOUR RUNS</span></div>:<>{tab==='home'&&<HomeView runs={runs} routes={routes} onAdd={()=>setShowAdd(true)} onRoute={showRoute}/>} {tab==='log'&&<RunsView runs={runs} routes={routes} onAdd={()=>setShowAdd(true)} onDelete={removeRun} onRoute={showRoute} onAttachRoute={attachRoute} nativeHealth={nativeHealth} onHealthSave={saveHealthRun}/>} {tab==='map'&&<MapView runs={runs} routes={routes} activeRoute={activeRoute} activeRouteDate={activeRouteDate} autoPlay={autoPlay} onSelect={showRoute} onAttach={attachRoute} onImport={()=>mapInputRef.current?.click()}/>} {tab==='insights'&&<InsightsView runs={runs}/>} {tab==='settings'&&<SettingsView onHealthImport={handleHealthImport} onGpxImport={handleGpxImport} syncing={saving} nativeHealth={nativeHealth} onHealthAuthorize={authorizeHealth}/>}</>}</main></div>
    <nav className="bottom-nav">{TABS.map(({id,label,icon:Icon})=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon/><span>{label}</span></button>)}</nav>
    <input ref={attachInputRef} hidden type="file" onChange={handleAttach}/><input ref={mapInputRef} hidden type="file" onChange={handleGpxImport}/>{showAdd&&<AddRunSheet onClose={()=>setShowAdd(false)} onSave={saveRun}/>} {celebration&&<Celebration run={celebration} onClose={()=>setCelebration(null)}/>} {toast&&<div className="toast"><MessageCircle size={16}/>{toast}</div>}
  </div>
}
