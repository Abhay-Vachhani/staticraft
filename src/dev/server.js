import http from 'node:http'
import fs from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm'
}

export class DevServer {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd()
        this.staticDir = options.staticDir || path.join(this.rootDir, '.raft')
        this.desiredPort = options.port || 4455
        this.bindHost = options.host ? '0.0.0.0' : '127.0.0.1'
        this.server = null
        this.activePort = this.desiredPort
        this.watcher = null
        this.builder = null
        this.rebuildTimer = null
        this.liveReloadClients = new Set()
    }

    notifyReload() {
        if (this.liveReloadClients.size === 0) return
        console.log(`[Staticraft Dev] Sending reload signal to ${this.liveReloadClients.size} client(s)...`)
        for (const clientRes of this.liveReloadClients) {
            try {
                clientRes.write('event: reload\ndata: {}\n\n')
            } catch (_) {}
        }
    }

    async handleRequest(req, res) {
        const startTime = Date.now()
        let reqUrl = req.url.split('?')[0]

        // Extensible Staticraft Dev SSE Event Stream endpoint
        if (reqUrl === '/__staticraft') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            })
            res.write('retry: 1000\n\n')
            this.liveReloadClients.add(res)
            const removeClient = () => this.liveReloadClients.delete(res)
            req.on('close', removeClient)
            res.on('close', removeClient)
            res.on('error', removeClient)
            return
        }

        let decodedUrl = reqUrl
        try {
            decodedUrl = decodeURIComponent(reqUrl)
        } catch (_) {}

        const safePath = path.normalize(decodedUrl).replace(/^(\.\.[\/\\])+/, '')
        const absStaticDir = path.resolve(this.staticDir)
        
        let candidatePaths = []

        if (safePath === '/' || safePath === '\\') {
            candidatePaths.push(path.join(absStaticDir, 'index.html'))
        } else if (!path.extname(safePath)) {
            candidatePaths.push(path.join(absStaticDir, safePath, 'index.html'))
            candidatePaths.push(path.join(absStaticDir, `${safePath}.html`))
            candidatePaths.push(path.join(absStaticDir, safePath))
        } else {
            candidatePaths.push(path.join(absStaticDir, safePath))
        }

        let resolvedPath = null

        const findResolvedPath = async () => {
            const is404Route = safePath === '/404' || safePath === '/404/'
            if (!is404Route) {
                for (const cand of candidatePaths) {
                    const absCand = path.resolve(cand)
                    if (absCand !== absStaticDir && !absCand.startsWith(absStaticDir + path.sep)) continue
                    try {
                        const stat = await fs.stat(absCand)
                        if (stat.isFile()) return absCand
                    } catch (_) {}
                }
            }
            return null
        }

        resolvedPath = await findResolvedPath()

        // Lazy On-Demand Rendering: Compile page on request if missing from .raft/
        if (!resolvedPath && this.builder && typeof this.builder.renderOnDemand === 'function') {
            try {
                await this.builder.renderOnDemand(safePath)
                resolvedPath = await findResolvedPath()
            } catch (err) {
                console.error(`[Staticraft Dev Server] Error compiling ${reqUrl} on demand:`, err.message)
            }
        }

        const logRequest = (statusCode) => {
            const duration = Date.now() - startTime
            const timeStr = `${duration}ms`
            const statusColor = statusCode >= 404 ? '404' : `${statusCode}`
            console.log(`  ${req.method} ${reqUrl} ${statusColor} in ${timeStr}`)
        }

        if (!resolvedPath) {
            res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
            
            // Check for custom 404 page: .raft/404.html or .raft/404/index.html
            const custom404Candidates = [
                path.join(this.staticDir, '404.html'),
                path.join(this.staticDir, '404', 'index.html')
            ]

            const loadCustom404 = async () => {
                for (const cand404 of custom404Candidates) {
                    try {
                        return await fs.readFile(cand404, 'utf-8')
                    } catch (_) {}
                }
                return null
            }

            let custom404Content = await loadCustom404()

            // If not compiled into .raft/ yet, attempt to render 404 page on demand
            if (!custom404Content && this.builder && typeof this.builder.renderOnDemand === 'function') {
                try {
                    await this.builder.renderOnDemand('/404')
                    custom404Content = await loadCustom404()
                } catch (err) {
                    console.error('[Staticraft Dev Server] Error compiling custom 404 page on demand:', err.message)
                }
            }

            if (custom404Content) {
                const liveReloadScript = `
<!-- Staticraft Dev Stream -->
<script>
(function() {
    if (typeof EventSource !== 'undefined') {
        var source = new EventSource('/__staticraft');
        source.addEventListener('reload', function() {
            console.log('[Staticraft] Live reload triggered.');
            window.location.reload();
        });
        source.onmessage = function(event) {
            if (event.data === 'reload') {
                window.location.reload();
            }
        };
    }
})();
</script>`
                let htmlStr = custom404Content
                if (htmlStr.includes('</body>')) {
                    htmlStr = htmlStr.replace('</body>', `${liveReloadScript}\n</body>`)
                } else {
                    htmlStr += liveReloadScript
                }
                res.end(htmlStr)
                return logRequest(404)
            }

            res.end(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 | Page Not Found</title>
    <style>
        body { background: #07080b; color: #f1f3f9; font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        .box { background: #0e1017; border: 1px solid rgba(255,255,255,0.1); padding: 3rem; border-radius: 16px; max-width: 460px; width: 90%; }
        h1 { font-size: 3.5rem; margin: 0 0 0.5rem; color: #e5c158; }
        h2 { font-size: 1.5rem; margin-bottom: 1rem; }
        p { color: #8b92a5; margin-bottom: 2rem; font-size: 0.95rem; line-height: 1.5; }
        code { background: rgba(255,255,255,0.08); padding: 0.2rem 0.5rem; border-radius: 4px; color: #f1f3f9; }
        a { display: inline-block; background: #e5c158; color: #000; padding: 0.75rem 1.75rem; border-radius: 8px; font-weight: 700; text-decoration: none; }
    </style>
</head>
<body>
    <div class="box">
        <h1>404</h1>
        <h2>Page Not Found</h2>
        <p>The requested route <code>${reqUrl}</code> could not be found in <code>.raft/</code> output.</p>
        <a href="/">Return to Home</a>
    </div>
</body>
</html>`)
            return logRequest(404)
        }

        try {
            const ext = path.extname(resolvedPath).toLowerCase()
            const mimeType = MIME_TYPES[ext] || 'application/octet-stream'
            let content = await fs.readFile(resolvedPath)

            // Inject Live Reload script into HTML responses during dev mode
            if (mimeType.startsWith('text/html')) {
                let htmlStr = content.toString('utf-8')
                const liveReloadScript = `
<!-- Staticraft Dev Stream -->
<script>
(function() {
    if (typeof EventSource !== 'undefined') {
        var source = new EventSource('/__staticraft');
        source.addEventListener('reload', function() {
            console.log('[Staticraft] Live reload triggered.');
            window.location.reload();
        });
        source.onmessage = function(event) {
            if (event.data === 'reload') {
                window.location.reload();
            }
        };
    }
})();
</script>`
                if (htmlStr.includes('</body>')) {
                    htmlStr = htmlStr.replace('</body>', `${liveReloadScript}\n</body>`)
                } else {
                    htmlStr += liveReloadScript
                }
                content = Buffer.from(htmlStr, 'utf-8')
            }

            res.writeHead(200, {
                'Content-Type': mimeType,
                'Cache-Control': 'no-store, must-revalidate'
            })
            res.end(content)
            logRequest(200)
        } catch (err) {
            res.writeHead(500)
            res.end('Internal Server Error')
            logRequest(500)
        }
    }

    startWatcher(builder) {
        if (!builder || !builder.srcDir) return

        try {
            this.watcher = watch(builder.srcDir, { recursive: true }, (eventType, filename) => {
                if (!filename || filename.startsWith('.') || filename.includes('.tmp')) return

                // Debounce invalidations & live reload trigger
                if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
                this.rebuildTimer = setTimeout(async () => {
                    const relDir = path.relative(this.rootDir, builder.srcDir)
                    console.log(`\n[Staticraft Watcher] File changed: ${path.join(relDir, filename)}`)
                    try {
                        if (typeof builder.clearCache === 'function') {
                            await builder.clearCache()
                        }
                        if (typeof builder.processAssets === 'function') {
                            await builder.processAssets()
                        }
                        this.notifyReload()
                    } catch (err) {
                        console.error('[Staticraft Watcher Error]', err.message)
                    }
                }, 100)
            })
        } catch (err) {
            console.warn('[Staticraft Watcher] Recursive watch warning:', err.message)
        }
    }

    async start(builder = null) {
        this.builder = builder

        // Initialize empty .raft directory for instant server startup
        if (builder) {
            if (typeof builder.clearCache === 'function') {
                await builder.clearCache()
            }
            this.startWatcher(builder)
        }

        return new Promise((resolve, reject) => {
            let attemptPort = this.desiredPort
            const maxAttempts = 20

            const tryListen = (port) => {
                const server = http.createServer((req, res) => this.handleRequest(req, res))

                server.once('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        console.warn(`[Staticraft Dev Server] Port ${port} is in use. Trying port ${port + 1}...`)
                        if (port - this.desiredPort < maxAttempts) {
                            tryListen(port + 1)
                        } else {
                            reject(new Error(`[Staticraft Dev Server] Could not find an available port between ${this.desiredPort} and ${port}`))
                        }
                    } else {
                        reject(err)
                    }
                })

                server.once('listening', () => {
                    this.server = server
                    this.activePort = port
                    console.log(`\n🚀 Staticraft Dev Server running at:`)
                    console.log(`   > Local:   http://localhost:${port}/`)
                    if (this.bindHost === '0.0.0.0') {
                        const interfaces = os.networkInterfaces()
                        for (const iface of Object.values(interfaces)) {
                            for (const addr of iface) {
                                if (addr.family === 'IPv4' && !addr.internal) {
                                    console.log(`   > Network: http://${addr.address}:${port}/`)
                                }
                            }
                        }
                    }
                    console.log(`   > Output:  .raft/`)
                    const watchDir = this.builder?.srcDir
                        ? path.relative(this.rootDir, this.builder.srcDir) + '/'
                        : 'src/'
                    console.log(`   > Watching: ${watchDir} for live changes...\n`)
                    resolve({ port, host: this.bindHost })
                })

                server.listen(port, this.bindHost)
            }

            tryListen(attemptPort)
        })
    }

    async stop() {
        if (this.rebuildTimer) clearTimeout(this.rebuildTimer)
        if (this.watcher) this.watcher.close()
        for (const clientRes of this.liveReloadClients) {
            try { clientRes.end() } catch (_) {}
        }
        this.liveReloadClients.clear()
        if (this.server) {
            return new Promise((resolve) => this.server.close(resolve))
        }
    }
}
