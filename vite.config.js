import { defineConfig, loadEnv } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import runsHandler from './api/runs.js'
import coachHandler from './api/coach.js'

function apiResponse(response) {
  return {
    setHeader(name, value) { response.setHeader(name, value) },
    status(code) { response.statusCode = code; return this },
    json(value) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)) },
  }
}

function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/api/')) return next()
        try {
          const chunks = []
          for await (const chunk of request) chunks.push(chunk)
          const raw = Buffer.concat(chunks).toString('utf8')
          request.body = raw ? JSON.parse(raw) : undefined
          if (request.url.startsWith('/api/runs')) return runsHandler(request, apiResponse(response))
          if (request.url.startsWith('/api/coach')) return coachHandler(request, apiResponse(response))
          return next()
        } catch (error) {
          response.statusCode = 500
          response.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}

function loadRawServerSecrets(mode) {
  const names = new Set(['JSONBIN_API_KEY', 'JSONBIN_BIN_ID', 'VITE_JSONBIN_API_KEY', 'VITE_JSONBIN_BIN_ID', 'ANTHROPIC_API_KEY'])
  const values = {}
  for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
    const path = resolve(process.cwd(), filename)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match || !names.has(match[1])) continue
      const raw = match[2].replace(/^(['"])(.*)\1$/, '$2')
      values[match[1]] = raw.replace(/\\\$/g, '$')
    }
  }
  return values
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  Object.assign(process.env, loadRawServerSecrets(mode))
  return {
  plugins: [
    react(),
    localApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: '러닝 대시보드',
        short_name: '러닝',
        description: '개인 러닝 기록 대시보드',
        theme_color: '#0a0b0d',
        background_color: '#0a0b0d',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'map-cache', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],
  }
})
