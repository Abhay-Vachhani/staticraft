import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TemplateEngine } from '../engine/template.js'
import { generateHashedAsset } from '../engine/hashing.js'
import { atomicWriteFile, atomicWriteBuffer } from './swapper.js'

export class SiteBuilder {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd()
        this.srcDir = options.srcDir || path.join(this.rootDir, 'src')
        this.outputDir = options.outputDir || path.join(this.rootDir, '.raft')
        this.engine = new TemplateEngine({
            rootDir: this.rootDir,
            templatesDir: this.srcDir
        })
        this.config = null
        this.assetMap = {}
        this.inflightPaths = new Map()
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
            this.config = { routes: {} }
            this.outputDir = path.resolve(this.rootDir, '.raft')
        }
        return this.config
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
            const rel = path.relative(this.srcDir, f)
            const isInternalJs = rel.startsWith('engine/') || rel.startsWith('worker/') || rel.startsWith('dev/') || rel === 'cli.js'
            return !f.endsWith('.html') && !path.basename(f).startsWith('.') && !isInternalJs
        })

        this.assetMap = {}
        const basenameOwners = new Map() // basename -> owning relativePath, or null once ambiguous
        for (const assetPath of assetFiles) {
            const relativePath = path.relative(this.srcDir, assetPath)
            const hashedAsset = await generateHashedAsset(assetPath)
            const dirName = path.dirname(relativePath)
            const hashedRelPath = dirName === '.'
                ? hashedAsset.hashedFileName
                : path.join(dirName, hashedAsset.hashedFileName)

            const hashedTargetPath = path.join(
                this.outputDir,
                dirName,
                hashedAsset.hashedFileName
            )

            await atomicWriteBuffer(hashedTargetPath, hashedAsset.content)

            const baseName = path.basename(assetPath)
            const owner = basenameOwners.get(baseName)
            if (owner === undefined) {
                basenameOwners.set(baseName, relativePath)
                this.assetMap[baseName] = hashedAsset.hashedFileName
            } else if (owner !== null && owner !== relativePath) {
                // Same filename exists in multiple directories: the bare-name
                // mapping is ambiguous, so drop it. Path-qualified references
                // (assetMap[relativePath]) still resolve correctly.
                console.warn(`[Staticraft Builder] Asset name "${baseName}" exists in multiple directories; only path-qualified references will be rewritten.`)
                delete this.assetMap[baseName]
                basenameOwners.set(baseName, null)
            }
            this.assetMap[relativePath] = hashedRelPath
        }
    }

    async buildRoute(routePattern, routeConfig) {
        if (!this.config) await this.loadConfig()

        let count = 0
        let routeType = 'Static'
        const revalidateVal = routeConfig.revalidate ? `${routeConfig.revalidate}s` : 'Manual'

        if (routePattern === '/') {
            const pagePath = path.join(this.srcDir, 'index.html')
            const data = routeConfig.data ? await routeConfig.data() : {}
            const rawContent = await fs.readFile(pagePath, 'utf-8')
            let compiledHtml = await this.engine.render(rawContent, data, this.assetMap)

            const targetPath = path.join(this.outputDir, 'index.html')
            await atomicWriteFile(targetPath, compiledHtml)
            count = 1
        } else if (routePattern.includes(':')) {
            routeType = 'Dynamic (SSG)'
            const baseDir = routePattern.split('/:')[0].replace(/^\//, '')
            const paramMatch = routePattern.match(/:([a-zA-Z0-9_]+)/)
            const paramKey = paramMatch ? paramMatch[1] : 'id'

            const templateCandidates = [
                path.join(this.srcDir, baseDir, `[${paramKey}].html`),
                path.join(this.srcDir, baseDir, '[id].html'),
                path.join(this.srcDir, baseDir, '[slug].html'),
                path.join(this.srcDir, baseDir, 'detail.html')
            ]
            
            let rawContent = ''
            for (const cand of templateCandidates) {
                try {
                    rawContent = await fs.readFile(cand, 'utf-8')
                    break
                } catch (_) {}
            }

            if (!rawContent) return { count: 0, routeType, revalidate: revalidateVal }

            let paths = []
            if (routeConfig.generatePaths) {
                try {
                    paths = await this.getGeneratedPaths(routePattern, routeConfig)
                } catch (err) {
                    console.error(`[Staticraft Builder Error] generatePaths() failed for ${routePattern}:`, err.message)
                }
            }
            for (const item of paths) {
                const paramValue = item.params ? (item.params[paramKey] || item.params.id || item.params.slug) : undefined
                if (!paramValue) continue

                let compiledHtml = await this.engine.render(rawContent, item.data || {}, this.assetMap)

                const targetPath = path.join(this.outputDir, baseDir, String(paramValue), 'index.html')
                await atomicWriteFile(targetPath, compiledHtml)
                count++
            }
        } else {
            const routeName = routePattern.replace(/^\//, '')
            const pagePath = path.join(this.srcDir, `${routeName}.html`)
            const data = routeConfig.data ? await routeConfig.data() : {}
            try {
                const rawContent = await fs.readFile(pagePath, 'utf-8')
                let compiledHtml = await this.engine.render(rawContent, data, this.assetMap)

                const targetPath = path.join(this.outputDir, routeName, 'index.html')
                await atomicWriteFile(targetPath, compiledHtml)
                count = 1
            } catch (_) {}
        }

        return { count, routeType, revalidate: revalidateVal }
    }

    async clearCache() {
        this.config = null
        this.assetMap = {}
        this.inflightPaths.clear()
        try {
            await fs.rm(this.outputDir, { recursive: true, force: true })
            await fs.mkdir(this.outputDir, { recursive: true })
        } catch (_) {}
    }

    async renderOnDemand(reqUrl) {
        if (!this.config) await this.loadConfig()
        if (Object.keys(this.assetMap).length === 0) {
            await this.processAssets()
        }

        const normalizedUrl = reqUrl.split('?')[0].replace(/\/$/, '') || '/'
        if (normalizedUrl.includes('..')) return
        const routes = this.config.routes || {}

        // 1. Check exact match in configured routes (e.g. '/' or '/products')
        if (routes[normalizedUrl]) {
            await this.buildRoute(normalizedUrl, routes[normalizedUrl])
            return
        }

        // 2. Check dynamic SSG routes (e.g. '/products/42' matching '/products/:id')
        for (const [routePattern, routeConfig] of Object.entries(routes)) {
            if (routePattern.includes(':')) {
                const baseDir = routePattern.split('/:')[0]
                const paramMatch = routePattern.match(/:([a-zA-Z0-9_]+)/)
                const paramKey = paramMatch ? paramMatch[1] : 'id'

                if (normalizedUrl.startsWith(baseDir + '/')) {
                    const reqParamValue = normalizedUrl.slice(baseDir.length + 1)
                    
                    const templateCandidates = [
                        path.join(this.srcDir, baseDir.replace(/^\//, ''), `[${paramKey}].html`),
                        path.join(this.srcDir, baseDir.replace(/^\//, ''), '[id].html'),
                        path.join(this.srcDir, baseDir.replace(/^\//, ''), '[slug].html'),
                        path.join(this.srcDir, baseDir.replace(/^\//, ''), 'detail.html')
                    ]

                    let rawContent = ''
                    for (const cand of templateCandidates) {
                        try {
                            rawContent = await fs.readFile(cand, 'utf-8')
                            break
                        } catch (_) {}
                    }

                    if (rawContent) {
                        let itemData = {}
                        if (routeConfig.generatePaths) {
                            let found
                            try {
                                const paths = await this.getGeneratedPaths(routePattern, routeConfig)
                                found = paths.find((p) => String(p.params?.[paramKey] || p.params?.id || p.params?.slug) === String(reqParamValue))
                            } catch (_) {}
                            // generatePaths() defines the full allowlist of valid pages for this
                            // route - a param that isn't in it is not a real page, so don't render one.
                            if (!found) continue
                            itemData = found.data || {}
                        } else if (routeConfig.data) {
                            try {
                                itemData = await routeConfig.data({ params: { [paramKey]: reqParamValue } })
                            } catch (_) {}
                        }

                        let compiledHtml = await this.engine.render(rawContent, itemData, this.assetMap)

                        const targetPath = path.join(this.outputDir, baseDir.replace(/^\//, ''), String(reqParamValue), 'index.html')
                        await atomicWriteFile(targetPath, compiledHtml)
                        return
                    }
                }
            }
        }

        // 3. Unconfigured static HTML pages (e.g. '/about' -> src/about.html or '/404' -> src/404.html)
        const cleanRouteName = normalizedUrl.replace(/^\//, '')
        if (cleanRouteName) {
            const pagePath = path.join(this.srcDir, `${cleanRouteName}.html`)
            try {
                const rawContent = await fs.readFile(pagePath, 'utf-8')
                let compiledHtml = await this.engine.render(rawContent, {}, this.assetMap)

                const targetPath = cleanRouteName === '404'
                    ? path.join(this.outputDir, '404.html')
                    : path.join(this.outputDir, cleanRouteName, 'index.html')

                await atomicWriteFile(targetPath, compiledHtml)
                return
            } catch (_) {}
        }
    }

    async build() {
        console.log(`[Staticraft Builder] Starting build...`)
        const startTime = Date.now()

        await this.loadConfig()
        await fs.mkdir(this.outputDir, { recursive: true })
        await this.processAssets()

        const buildManifest = []
        let totalPages = 0
        let totalStaticCount = 0
        let totalSsgCount = 0
        const defaultExpiry = this.config.defaultExpiry || '1y'

        // 1. Render configured routes from staticraft.config.js
        const routes = this.config.routes || {}
        for (const [routePattern, routeConfig] of Object.entries(routes)) {
            const { count, routeType, revalidate } = await this.buildRoute(routePattern, routeConfig)
            totalPages += count
            if (routeType.includes('Dynamic')) {
                totalSsgCount += count
            } else {
                totalStaticCount += count
            }
            buildManifest.push({
                route: routePattern,
                type: routeType,
                revalidate,
                expiry: '1 Year',
                count
            })
        }

        // 2. Render unconfigured static HTML pages
        const allFiles = await this.getFiles(this.srcDir)
        const otherHtmlFiles = allFiles.filter((f) => {
            const rel = path.relative(this.srcDir, f)
            const baseName = path.basename(f)
            const isLayoutOrComp = rel.startsWith('layouts/') || rel.startsWith('components/') || rel.startsWith('_')
            const isBracketTemplate = baseName.includes('[') || baseName.includes(']')
            const routeName = '/' + rel.replace(/\.html$/, '')
            const isConfigured = Boolean(routes[routeName]) || rel === 'index.html'
            return f.endsWith('.html') && !isLayoutOrComp && !isBracketTemplate && !isConfigured && !baseName.startsWith('_')
        })

        for (const pagePath of otherHtmlFiles) {
            const relativePath = path.relative(this.srcDir, pagePath)
            const routeName = relativePath.slice(0, -5)
            
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
            let compiledHtml = await this.engine.render(rawContent, {}, this.assetMap)

            await atomicWriteFile(targetPath, compiledHtml)
            totalPages++
            totalStaticCount++
            buildManifest.push({
                route: displayRoute,
                type: 'Static',
                revalidate: '-',
                expiry: '-',
                count: 1
            })
        }

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
