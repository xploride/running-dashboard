import { useEffect, useMemo, useRef, useState } from 'react'
import { LngLatBounds, Map, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { haversine } from '../lib/runData'

setWorkerUrl(workerUrl)

const EMPTY_LINE = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }

function lineFeature(coords) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: coords.map((point) => [point.lng, point.lat]) },
  }
}

function routeMetrics(coords) {
  if (coords.length < 2) return { cumulative: [0], total: 0 }
  const cumulative = [0]
  for (let index = 1; index < coords.length; index += 1) {
    cumulative[index] = cumulative[index - 1] + haversine(coords[index - 1], coords[index])
  }
  return { cumulative, total: cumulative.at(-1) }
}

function pointAtProgress(coords, metrics, progress) {
  if (!coords.length) return null
  if (progress <= 0 || metrics.total === 0) return { point: coords[0], partial: [coords[0]] }
  if (progress >= 1) return { point: coords.at(-1), partial: coords }

  const target = metrics.total * progress
  let index = 1
  while (index < metrics.cumulative.length && metrics.cumulative[index] < target) index += 1
  const previousDistance = metrics.cumulative[index - 1]
  const segmentDistance = metrics.cumulative[index] - previousDistance || 1
  const ratio = (target - previousDistance) / segmentDistance
  const start = coords[index - 1]
  const end = coords[index]
  const point = {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
  }
  return { point, partial: [...coords.slice(0, index), point] }
}

function markerElement(className) {
  const element = document.createElement('div')
  element.className = className
  return element
}

export default function RunMap({ route, autoPlay = false }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const runnerRef = useRef(null)
  const endpointsRef = useRef([])
  const frameRef = useRef(null)
  const progressRef = useRef(0)
  const playingRef = useRef(false)
  const lastFrameRef = useRef(0)

  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const coords = useMemo(() => route?.coords || [], [route?.coords])
  const metrics = useMemo(() => routeMetrics(coords), [coords])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined
    const map = new Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/bright',
      center: [126.978, 37.5665],
      zoom: 11,
      pitch: 0,
      attributionControl: true,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      map.addSource('route-full', { type: 'geojson', data: EMPTY_LINE, lineMetrics: true })
      map.addLayer({
        id: 'route-shadow', type: 'line', source: 'route-full',
        paint: { 'line-color': '#020304', 'line-width': 11, 'line-opacity': 0.62, 'line-blur': 2 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'route-base', type: 'line', source: 'route-full',
        paint: { 'line-color': '#c2c8c0', 'line-width': 6, 'line-opacity': 0.42 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addSource('route-progress', { type: 'geojson', data: EMPTY_LINE, lineMetrics: true })
      map.addLayer({
        id: 'route-progress-line', type: 'line', source: 'route-progress',
        paint: {
          'line-width': 7,
          'line-opacity': 1,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#B8FF34', 0.55, '#FFE24A', 1, '#FF6B32'],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      setReady(true)
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)
    mapRef.current = map
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frameRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  const renderProgress = (value) => {
    const map = mapRef.current
    if (!map || !ready || coords.length < 2) return
    const result = pointAtProgress(coords, metrics, value)
    map.getSource('route-progress')?.setData(lineFeature(result.partial))
    runnerRef.current?.setLngLat([result.point.lng, result.point.lat])
  }

  const stop = () => {
    playingRef.current = false
    setPlaying(false)
    cancelAnimationFrame(frameRef.current)
  }

  const tick = (timestamp) => {
    if (!playingRef.current) return
    if (!lastFrameRef.current) lastFrameRef.current = timestamp
    const delta = timestamp - lastFrameRef.current
    lastFrameRef.current = timestamp
    const next = Math.min(1, progressRef.current + delta / 12000)
    progressRef.current = next
    setProgress(next)
    renderProgress(next)
    if (next >= 1) stop()
    else frameRef.current = requestAnimationFrame(tick)
  }

  const play = () => {
    if (coords.length < 2) return
    if (progressRef.current >= 1) {
      progressRef.current = 0
      setProgress(0)
      renderProgress(0)
    }
    playingRef.current = true
    lastFrameRef.current = 0
    setPlaying(true)
    frameRef.current = requestAnimationFrame(tick)
  }

  const reset = () => {
    stop()
    progressRef.current = 0
    setProgress(0)
    renderProgress(0)
  }

  useEffect(() => {
    if (!ready || coords.length < 2) return
    playingRef.current = false
    cancelAnimationFrame(frameRef.current)
    queueMicrotask(() => setPlaying(false))
    endpointsRef.current.forEach((marker) => marker.remove())
    endpointsRef.current = []
    runnerRef.current?.remove()

    mapRef.current.getSource('route-full')?.setData(lineFeature(coords))
    mapRef.current.getSource('route-progress')?.setData(lineFeature([coords[0], coords[0]]))

    const bounds = new LngLatBounds()
    coords.forEach((point) => bounds.extend([point.lng, point.lat]))
    mapRef.current.fitBounds(bounds, { padding: 52, duration: 900, maxZoom: 16 })

    endpointsRef.current = [
      new Marker({ element: markerElement('map-endpoint map-endpoint--start'), anchor: 'center' }).setLngLat([coords[0].lng, coords[0].lat]).addTo(mapRef.current),
      new Marker({ element: markerElement('map-endpoint map-endpoint--finish'), anchor: 'center' }).setLngLat([coords.at(-1).lng, coords.at(-1).lat]).addTo(mapRef.current),
    ]
    runnerRef.current = new Marker({ element: markerElement('map-runner'), anchor: 'center' }).setLngLat([coords[0].lng, coords[0].lat]).addTo(mapRef.current)
    progressRef.current = 0
    queueMicrotask(() => setProgress(0))
    if (autoPlay) setTimeout(play, 950)
    return () => cancelAnimationFrame(frameRef.current)
    // Route identity is intentionally the animation reset boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, route?.id])

  return (
    <div className={`run-map-shell${route ? '' : ' run-map-shell--empty'}`}>
      <div ref={containerRef} className="run-map" />
      {route&&<div className="map-overlay map-overlay--top">
        <span className="map-route-label">{route.run?.note || 'RUN ROUTE'}</span>
        <strong>{metrics.total.toFixed(2)} KM</strong>
      </div>}
      {route&&<div className="map-player">
        <div className="map-progress-track" onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const next = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
          progressRef.current = next
          setProgress(next)
          renderProgress(next)
        }}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="map-player__row">
          <button className="icon-button" onClick={reset} aria-label="경로 처음으로"><RotateCcw size={18} /></button>
          <button className="play-button" onClick={playing ? stop : play} aria-label={playing ? '일시 정지' : '재생'}>
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
            <span>{playing ? 'PAUSE' : progress >= 1 ? 'REPLAY' : 'PLAY RUN'}</span>
          </button>
          <span className="map-player__percent">{Math.round(progress * 100)}%</span>
        </div>
      </div>}
    </div>
  )
}
