import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TemplateEngine, escapeHtml } from '../engine/template.js'
import { generateHashedAsset } from '../engine/hashing.js'
import { atomicWriteFile, atomicWriteBuffer } from './swapper.js'

const DURATION_UNITS = [
    { unit: 'year', secs: 31536000 },
    { unit: 'week', secs: 604800 },
    { unit: 'day', secs: 86400 },
    { unit: 'hr', secs: 3600 },
    { unit: 'min', secs: 60 },
    { unit: 'sec', secs: 1 },
]

/**
 * Formats a revalidate interval in seconds as a human-readable duration,
 * e.g. 600 -> "10 mins", 3600 -> "1 hr", 604800 -> "1 week".
 */
export function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return 'Manual'
    for (const { unit, secs } of DURATION_UNITS) {
        if (seconds >= secs) {
            const value = seconds / secs
            const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10
            return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`
        }
    }
    return `${seconds} secs`
}

function matchesPattern(str, pattern) {
    if (!pattern) return false
    const cleanPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern
    if (cleanPattern === str) return true
    const regexStr = '^' + cleanPattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => (m === '*' ? '.*' : m === '?' ? '.' : '\\' + m)) + '$'
    return new RegExp(regexStr).test(str)
}

function shouldIgnoreHash(assetPath, relativePath, ignoreHash) {
    if (!ignoreHash) return false
    const list = Array.isArray(ignoreHash) ? ignoreHash : [ignoreHash]
    const baseName = path.basename(assetPath)
    return list.some((p) => {
        if (typeof p !== 'string') return false
        const trimmed = p.trim()
        return matchesPattern(baseName, trimmed) || matchesPattern(relativePath, trimmed)
    })
}

export class SiteBuilder {
    constructor(options = {}) {
        this.options = options
        this.rootDir = options.rootDir || process.cwd()
        this.isDev = Boolean(options.isDev)
        this.srcDir = this.resolveSrcDir(options.srcDir)
        this.outputDir = options.outputDir || path.join(this.rootDir, '.raft')
        this.engine = new TemplateEngine({
            rootDir: this.rootDir,
            templatesDir: this.srcDir
        })
        this.config = null
        this.routes = null
        this.assetMap = {}
        this.basePath = ''
        this.inflightPaths = new Map()
    }

    resolveBasePath(config) {
        if (config?.basePath !== undefined) {
            let bp = String(config.basePath).trim()
            if (!bp || bp === '/') return ''
            if (!bp.startsWith('/')) bp = '/' + bp
            return bp.replace(/\/+$/, '')
        }
        if (config?.siteUrl) {
            try {
                const u = new URL(config.siteUrl)
                const pathname = u.pathname.replace(/\/+$/, '')
                if (pathname && pathname !== '/') return pathname
            } catch (_) {}
        }
        return ''
    }

    resolveSrcDir(optionsSrcDir) {
        if (optionsSrcDir) {
            return path.resolve(this.rootDir, optionsSrcDir)
        }
        if (this.config && this.config.srcDir) {
            return path.resolve(this.rootDir, this.config.srcDir)
        }
        const appDir = path.join(this.rootDir, 'app')
        const srcAppDir = path.join(this.rootDir, 'src', 'app')
        if (existsSync(appDir)) {
            return appDir
        }
        if (existsSync(srcAppDir)) {
            return srcAppDir
        }
        return appDir
    }

    /**
     * Coalesces concurrent generatePaths() calls for the same route so a burst
     * of on-demand requests doesn't trigger duplicate (e.g. network) fetches.
     */
    async getGeneratedPaths(routePattern, routeConfig) {
        if (this.inflightPaths.has(routePattern)) {
            return this.inflightPaths.get(routePattern)
        }
        const promise = (async () => {
            try {
                return await routeConfig.generatePaths()
            } finally {
                this.inflightPaths.delete(routePattern)
            }
        })()
        this.inflightPaths.set(routePattern, promise)
        return promise
    }

    async loadConfig() {
        const configPath = path.join(this.rootDir, 'staticraft.config.js')
        try {
            const configUrl = pathToFileURL(configPath).href
            const module = await import(`${configUrl}?t=${Date.now()}`)
            this.config = module.default || {}
            this.outputDir = path.resolve(this.rootDir, this.config.outputDir || '.raft')
        } catch (err) {
            this.config = {}
            this.outputDir = path.resolve(this.rootDir, '.raft')
        }
        this.srcDir = this.resolveSrcDir(this.options?.srcDir)
        this.basePath = this.resolveBasePath(this.config)
        this.engine.templatesDir = this.srcDir
        await this.discoverRoutes()
        await this.processAssets()
        return this.config
    }

    /**
     * File-based routing: every `page.html` found under src/app/ defines a route.
     * Its parent folder path (relative to src/app/) becomes the route pattern,
     * with `[param]` segments turned into `:param` - src/app/page.html itself
     * (empty relative path) is the root route "/". A sibling `server.js` in
     * the same folder (optional) supplies data/generatePaths/revalidate.
     */
    async discoverRoutes() {
        const routes = {}
        const allFiles = await this.getFiles(this.srcDir)
        const pageFiles = allFiles.filter((f) => path.basename(f) === 'page.html')

        for (const pagePath of pageFiles) {
            const dir = path.dirname(pagePath)
            const relDir = path.relative(this.srcDir, dir)
            const segments = relDir === '.' ? [] : relDir.split(path.sep)

            const routePattern = '/' + segments
                .map((seg) => (seg.startsWith('[') && seg.endsWith(']') ? `:${seg.slice(1, -1)}` : seg))
                .join('/')

            let mod = {}
            const serverPath = path.join(dir, 'server.js')
            try {
                const serverUrl = pathToFileURL(serverPath).href
                const serverModule = await import(`${serverUrl}?t=${Date.now()}`)
                mod = serverModule.default || {}
            } catch (_) {}

            routes[routePattern] = { dir, mod }
        }

        this.routes = routes
        return routes
    }

    async getFiles(dir) {
        let results = []
        try {
            const list = await fs.readdir(dir, { withFileTypes: true })
            for (const file of list) {
                const fullPath = path.join(dir, file.name)
                if (file.isDirectory()) {
                    const subFiles = await this.getFiles(fullPath)
                    results = results.concat(subFiles)
                } else {
                    results.push(fullPath)
                }
            }
        } catch (_) {}
        return results
    }

    async processAssets() {
        const allFiles = await this.getFiles(this.srcDir)
        const assetFiles = allFiles.filter((f) => {
            const isRouteServerFile = path.basename(f) === 'server.js'
            const isGeneratedWellKnown = path.basename(f) === 'robots.txt' || path.basename(f) === 'sitemap.xml'
            const isRootTxtFile = f.endsWith('.txt') && path.dirname(f) === this.srcDir
            return !f.endsWith('.html') && !path.basename(f).startsWith('.') && !isRouteServerFile && !isGeneratedWellKnown && !isRootTxtFile
        })

        const rootTxtFiles = allFiles.filter((f) => f.endsWith('.txt') && path.dirname(f) === this.srcDir && path.basename(f) !== 'robots.txt')
        for (const txtFile of rootTxtFiles) {
            const fileName = path.basename(txtFile)
            const content = await fs.readFile(txtFile)
            await atomicWriteBuffer(path.join(this.outputDir, fileName), content)
        }

        this.assetMap = {}
        const basenameOwners = new Map() // basename -> owning relativePath, or null once ambiguous
        const ignoreHashConfig = this.config?.ignoreHash
        for (const assetPath of assetFiles) {
            const relativePath = path.relative(this.srcDir, assetPath)
            const isIgnored = shouldIgnoreHash(assetPath, relativePath, ignoreHashConfig)

            let finalRelPath
            let finalFileName
            let content

            if (isIgnored) {
                content = await fs.readFile(assetPath)
                finalFileName = path.basename(assetPath)
                finalRelPath = relativePath
                const targetPath = path.join(this.outputDir, relativePath)
                await atomicWriteBuffer(targetPath, content)
            } else {
                const hashedAsset = await generateHashedAsset(assetPath)
                const dirName = path.dirname(relativePath)
                finalFileName = hashedAsset.hashedFileName
                finalRelPath = dirName === '.'
                    ? hashedAsset.hashedFileName
                    : path.join(dirName, hashedAsset.hashedFileName)
                content = hashedAsset.content

                const hashedTargetPath = path.join(
                    this.outputDir,
                    dirName,
                    hashedAsset.hashedFileName
                )
                await atomicWriteBuffer(hashedTargetPath, content)
            }

            const baseName = path.basename(assetPath)
            const owner = basenameOwners.get(baseName)
            if (owner === undefined) {
                basenameOwners.set(baseName, relativePath)
                this.assetMap[baseName] = finalFileName
            } else if (owner !== null && owner !== relativePath) {
                // Same filename exists in multiple directories: the bare-name
                // mapping is ambiguous, so drop it. Path-qualified references
                // (assetMap[relativePath]) still resolve correctly.
                console.warn(`[Staticraft Builder] Asset name "${baseName}" exists in multiple directories; only path-qualified references will be rewritten.`)
                delete this.assetMap[baseName]
                basenameOwners.set(baseName, null)
            }
            this.assetMap[relativePath] = finalRelPath
        }
    }

    async buildRoute(routePattern, routeEntry) {
        if (!this.routes) await this.loadConfig()

        const { dir, mod } = routeEntry
        let count = 0
        let routeType = 'Static'
        let urls = []
        const revalidateVal = formatDuration(mod.revalidate)

        if (routePattern === '/') {
            const pagePath = path.join(dir, 'page.html')
            const data = mod.data ? await mod.data() : {}
            const rawContent = await fs.readFile(pagePath, 'utf-8')
            let compiledHtml = await this.engine.render(rawContent, data, this.assetMap, this.basePath)

            const targetPath = path.join(this.outputDir, 'index.html')
            await atomicWriteFile(targetPath, compiledHtml)
            count = 1
            urls = ['/']
        } else if (routePattern.includes(':')) {
            routeType = 'Dynamic (SSG)'
            const baseDir = routePattern.split('/:')[0].replace(/^\//, '')
            const paramMatch = routePattern.match(/:([a-zA-Z0-9_]+)/)
            const paramKey = paramMatch ? paramMatch[1] : 'id'

            const pagePath = path.join(dir, 'page.html')
            let rawContent = ''
            try {
                rawContent = await fs.readFile(pagePath, 'utf-8')
            } catch (_) {}

            if (!rawContent) return { count: 0, routeType, revalidate: revalidateVal, urls }

            let paths = []
            if (mod.generatePaths) {
                try {
                    paths = await this.getGeneratedPaths(routePattern, mod)
                } catch (err) {
                    console.error(`[Staticraft Builder Error] generatePaths() failed for ${routePattern}:`, err.message)
                }
            }
            for (const item of paths) {
                const paramValue = item.params ? (item.params[paramKey] || item.params.id || item.params.slug) : undefined
                if (!paramValue) continue

                let compiledHtml = await this.engine.render(rawContent, item.data || {}, this.assetMap, this.basePath)

                const targetPath = path.join(this.outputDir, baseDir, String(paramValue), 'index.html')
                const resolvedTarget = path.resolve(targetPath)
                const absOutputDir = path.resolve(this.outputDir)
                if (resolvedTarget !== absOutputDir && !resolvedTarget.startsWith(absOutputDir + path.sep)) {
                    throw new Error(`[Staticraft Builder Security] Unsafe route path traversal: ${paramValue}`)
                }
                await atomicWriteFile(targetPath, compiledHtml)
                count++
                urls.push(`/${baseDir}/${paramValue}`)
            }
        } else {
            const routeName = routePattern.replace(/^\//, '')
            const pagePath = path.join(dir, 'page.html')
            const data = mod.data ? await mod.data() : {}
            try {
                const rawContent = await fs.readFile(pagePath, 'utf-8')
                let compiledHtml = await this.engine.render(rawContent, data, this.assetMap, this.basePath)

                const targetPath = path.join(this.outputDir, routeName, 'index.html')
                await atomicWriteFile(targetPath, compiledHtml)
                count = 1
                urls = [routePattern]
            } catch (_) {}
        }

        return { count, routeType, revalidate: revalidateVal, urls }
    }

    async clearCache() {
        this.config = null
        this.routes = null
        this.assetMap = {}
        this.inflightPaths.clear()
        try {
            await fs.rm(this.outputDir, { recursive: true, force: true })
            await fs.mkdir(this.outputDir, { recursive: true })
        } catch (_) {}
    }

    async renderOnDemand(reqUrl) {
        if (!this.routes) await this.loadConfig()
        if (Object.keys(this.assetMap).length === 0) {
            await this.processAssets()
        }

        const normalizedUrl = reqUrl.split('?')[0].replace(/\/$/, '') || '/'
        if (normalizedUrl.includes('..')) return
        const routes = this.routes || {}

        // 0. robots.txt / sitemap.xml are generated on demand too, not just on `build()`
        if (normalizedUrl === '/robots.txt') {
            await this.writeRobotsTxt()
            return
        }
        if (normalizedUrl === '/sitemap.xml') {
            const urls = this.config.siteUrl ? await this.collectAllSiteUrls() : []
            await this.writeSitemapXml(urls)
            return
        }

        // 1. Check exact match against discovered routes (e.g. '/' or '/products')
        if (routes[normalizedUrl]) {
            await this.buildRoute(normalizedUrl, routes[normalizedUrl])
            return
        }

        // 2. Check dynamic SSG routes (e.g. '/products/42' matching '/products/:id')
        for (const [routePattern, routeEntry] of Object.entries(routes)) {
            if (routePattern.includes(':')) {
                const { dir, mod } = routeEntry
                const baseDir = routePattern.split('/:')[0]
                const paramMatch = routePattern.match(/:([a-zA-Z0-9_]+)/)
                const paramKey = paramMatch ? paramMatch[1] : 'id'

                if (normalizedUrl.startsWith(baseDir + '/')) {
                    const reqParamValue = normalizedUrl.slice(baseDir.length + 1)

                    const pagePath = path.join(dir, 'page.html')
                    let rawContent = ''
                    try {
                        rawContent = await fs.readFile(pagePath, 'utf-8')
                    } catch (_) {}

                    if (rawContent) {
                        // Prefer a by-id data() fetch for on-demand rendering: it's a single
                        // targeted request, whereas generatePaths() re-fetches the entire
                        // collection just to pick out one item. generatePaths() is still what
                        // build()/schedule use to enumerate & prebuild every page, and remains
                        // the fallback here for routes that don't define data().
                        let itemData = null
                        if (mod.data) {
                            try {
                                itemData = await mod.data({ params: { [paramKey]: reqParamValue } })
                            } catch (_) {
                                itemData = null
                            }
                        } else if (mod.generatePaths) {
                            let found
                            try {
                                const paths = await this.getGeneratedPaths(routePattern, mod)
                                found = paths.find((p) => String(p.params?.[paramKey] || p.params?.id || p.params?.slug) === String(reqParamValue))
                            } catch (_) {}
                            if (found) itemData = found.data || {}
                        }

                        // No data resolved (data() returned null/undefined, or the id wasn't in
                        // generatePaths()'s allowlist) - this isn't a real page, don't render one.
                        if (!itemData) continue

                        let compiledHtml = await this.engine.render(rawContent, itemData, this.assetMap, this.basePath)

                        const targetPath = path.join(this.outputDir, baseDir.replace(/^\//, ''), String(reqParamValue), 'index.html')
                        await atomicWriteFile(targetPath, compiledHtml)
                        return
                    }
                }
            }
        }

        // 3. Unconfigured static HTML pages (e.g. '/about' -> src/app/about.html or '/404' -> src/app/404.html)
        const cleanRouteName = normalizedUrl.replace(/^\//, '')
        if (cleanRouteName) {
            const pagePath = path.join(this.srcDir, `${cleanRouteName}.html`)
            const resolvedPagePath = path.resolve(pagePath)
            const absSrcDir = path.resolve(this.srcDir)
            if (resolvedPagePath === absSrcDir || resolvedPagePath.startsWith(absSrcDir + path.sep)) {
                try {
                    const rawContent = await fs.readFile(resolvedPagePath, 'utf-8')
                    let compiledHtml = await this.engine.render(rawContent, {}, this.assetMap, this.basePath)

                    const targetPath = cleanRouteName === '404'
                        ? path.join(this.outputDir, '404.html')
                        : path.join(this.outputDir, cleanRouteName, 'index.html')

                    await atomicWriteFile(targetPath, compiledHtml)
                    return
                } catch (_) {}
            }
        }
    }

    /**
     * Enumerates every URL Staticraft knows about without rendering any pages -
     * used to generate an accurate sitemap.xml on demand in dev mode, where most
     * pages haven't been built yet. Dynamic routes still need generatePaths()
     * to know their full set of ids; that's the one unavoidable cost of listing
     * every page, and only happens when sitemap.xml itself is requested.
     */
    async collectAllSiteUrls() {
        if (!this.routes) await this.loadConfig()
        const routes = this.routes || {}
        const urls = []

        for (const [routePattern, routeEntry] of Object.entries(routes)) {
            const { mod } = routeEntry
            if (routePattern.includes(':')) {
                if (!mod.generatePaths) continue
                const baseDir = routePattern.split('/:')[0].replace(/^\//, '')
                const paramMatch = routePattern.match(/:([a-zA-Z0-9_]+)/)
                const paramKey = paramMatch ? paramMatch[1] : 'id'
                let paths = []
                try {
                    paths = await this.getGeneratedPaths(routePattern, mod)
                } catch (_) {}
                for (const item of paths) {
                    const paramValue = item.params ? (item.params[paramKey] || item.params.id || item.params.slug) : undefined
                    if (paramValue) urls.push(`/${baseDir}/${paramValue}`)
                }
            } else {
                urls.push(routePattern)
            }
        }

        const allFiles = await this.getFiles(this.srcDir)
        const otherHtmlFiles = allFiles.filter((f) => {
            const rel = path.relative(this.srcDir, f)
            const baseName = path.basename(f)
            const isLayoutOrComp = rel.startsWith('layouts/') || rel.startsWith('components/') || rel.startsWith('_')
            return f.endsWith('.html') && baseName !== 'page.html' && !isLayoutOrComp && !baseName.startsWith('_')
        })
        for (const pagePath of otherHtmlFiles) {
            const relativePath = path.relative(this.srcDir, pagePath)
            const routeName = relativePath.slice(0, -5)
            if (relativePath === '404.html' || routeName === '404') continue

            const wouldBeRoutePattern = '/' + routeName
            if (routes[wouldBeRoutePattern]) continue // shadowed by a folder-based route
            urls.push(wouldBeRoutePattern)
        }

        return urls
    }

    async writeSitemapXml(siteUrls) {
        const siteUrl = this.config.siteUrl ? this.config.siteUrl.replace(/\/+$/, '') : null
        if (!siteUrl) {
            console.warn('[Staticraft Builder] No "siteUrl" configured in staticraft.config.js - skipping sitemap.xml generation.')
            return
        }
        const urlEntries = siteUrls
            .map((urlPath) => `    <url><loc>${escapeHtml(siteUrl + urlPath)}</loc></url>`)
            .join('\n')
        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`
        await atomicWriteFile(path.join(this.outputDir, 'sitemap.xml'), sitemapXml)
    }

    async writeRobotsTxt() {
        const siteUrl = this.config.siteUrl ? this.config.siteUrl.replace(/\/+$/, '') : null
        const robotsTxt = siteUrl
            ? `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
            : `User-agent: *\nAllow: /\n`
        await atomicWriteFile(path.join(this.outputDir, 'robots.txt'), robotsTxt)
    }

    async build() {
        console.log(`[Staticraft Builder] Starting build...`)
        const startTime = Date.now()

        await this.loadConfig()
        await fs.mkdir(this.outputDir, { recursive: true })
        await this.processAssets()

        const buildManifest = []
        const siteUrls = []
        let totalPages = 0
        let totalStaticCount = 0
        let totalSsgCount = 0
        const defaultExpiry = this.config.defaultExpiry || '1y'

        // 1. Render file-based routes discovered from src/app/**/page.html
        const routes = this.routes || {}
        for (const [routePattern, routeEntry] of Object.entries(routes)) {
            const { count, routeType, revalidate, urls } = await this.buildRoute(routePattern, routeEntry)
            totalPages += count
            if (routeType.includes('Dynamic')) {
                totalSsgCount += count
            } else {
                totalStaticCount += count
            }
            siteUrls.push(...urls)
            buildManifest.push({
                route: routePattern,
                type: routeType,
                revalidate,
                expiry: '1 Year',
                count
            })
        }

        // 2. Render flat, purely-static HTML pages (no folder/server.js of their own)
        const allFiles = await this.getFiles(this.srcDir)
        const otherHtmlFiles = allFiles.filter((f) => {
            const rel = path.relative(this.srcDir, f)
            const baseName = path.basename(f)
            const isLayoutOrComp = rel.startsWith('layouts/') || rel.startsWith('components/') || rel.startsWith('_')
            return f.endsWith('.html') && baseName !== 'page.html' && !isLayoutOrComp && !baseName.startsWith('_')
        })

        for (const pagePath of otherHtmlFiles) {
            const relativePath = path.relative(this.srcDir, pagePath)
            const routeName = relativePath.slice(0, -5)
            const wouldBeRoutePattern = '/' + routeName

            if (routes[wouldBeRoutePattern]) {
                console.warn(`[Staticraft Builder] "${relativePath}" is shadowed by the folder-based route "${wouldBeRoutePattern}" (page.html); the flat file is ignored.`)
                continue
            }

            let targetPath
            let displayRoute

            if (relativePath === '404.html' || routeName === '404') {
                targetPath = path.join(this.outputDir, '404.html')
                displayRoute = '404'
            } else {
                targetPath = path.join(this.outputDir, routeName, 'index.html')
                displayRoute = `/${routeName}`
            }

            const rawContent = await fs.readFile(pagePath, 'utf-8')
            let compiledHtml = await this.engine.render(rawContent, {}, this.assetMap, this.basePath)

            await atomicWriteFile(targetPath, compiledHtml)
            totalPages++
            totalStaticCount++
            if (displayRoute !== '404') siteUrls.push(displayRoute)
            buildManifest.push({
                route: displayRoute,
                type: 'Static',
                revalidate: '-',
                expiry: '-',
                count: 1
            })
        }

        // 3. sitemap.xml (requires an absolute siteUrl) and robots.txt (always).
        // Reuses the urls already collected above - avoids re-fetching generatePaths().
        await this.writeSitemapXml(siteUrls)
        await this.writeRobotsTxt()

        const elapsed = Date.now() - startTime

        // Sort manifest so special system pages (404) appear at the very bottom
        buildManifest.sort((a, b) => {
            if (a.route === '404') return 1
            if (b.route === '404') return -1
            return 0
        })

        // Print clean enclosed box table with Revalidate & Expiry columns
        const w1 = 26
        const w2 = 14
        const w3 = 14
        const w4 = 10

        const topBorder = `┌${'─'.repeat(w1)}┬${'─'.repeat(w2)}┬${'─'.repeat(w3)}┬${'─'.repeat(w4)}┐`
        const midBorder = `├${'─'.repeat(w1)}┼${'─'.repeat(w2)}┼${'─'.repeat(w3)}┼${'─'.repeat(w4)}┤`
        const botBorder = `└${'─'.repeat(w1)}┴${'─'.repeat(w2)}┴${'─'.repeat(w3)}┴${'─'.repeat(w4)}┘`

        console.log(`\n${topBorder}`)
        console.log(`│ ${'Route (Staticraft)'.padEnd(w1 - 2, ' ')} │ ${'Revalidate'.padEnd(w2 - 2, ' ')} │ ${'Cache Expiry'.padEnd(w3 - 2, ' ')} │ ${'Count'.padStart(w4 - 2, ' ')} │`)
        console.log(midBorder)

        for (const item of buildManifest) {
            const symbol = item.type.includes('Dynamic') ? '●' : '○'
            const routeStr = `${symbol} ${item.route}`.padEnd(w1 - 2, ' ')
            const revalidateStr = item.revalidate.padEnd(w2 - 2, ' ')
            const expiryStr = item.expiry.padEnd(w3 - 2, ' ')
            const countStr = String(item.count).padStart(w4 - 2, ' ')
            console.log(`│ ${routeStr} │ ${revalidateStr} │ ${expiryStr} │ ${countStr} │`)
        }

        console.log(botBorder)
        console.log(`\n  ○  (Static)        ${totalStaticCount} ${totalStaticCount === 1 ? 'page' : 'pages'}`)
        console.log(`  ●  (SSG Dynamic)   ${totalSsgCount} ${totalSsgCount === 1 ? 'page' : 'pages'}`)
        console.log(`\n  ✦ Total Pages:   ${totalPages} static pages compiled into .raft/ (${elapsed}ms)`)
        console.log(`  ✦ Default Cache: max-age=31536000, immutable (1 Year CDN/Browser Expiry)\n`)

        return { totalPages, elapsed, buildManifest }
    }
}
