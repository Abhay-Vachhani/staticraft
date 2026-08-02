import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { TemplateEngine } from '../engine/template.js'
import { generateHashedAsset, rewriteAssetUrls } from '../engine/hashing.js'
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
        for (const assetPath of assetFiles) {
            const relativePath = path.relative(this.srcDir, assetPath)
            const hashedAsset = await generateHashedAsset(assetPath)
            const hashedTargetPath = path.join(
                this.outputDir,
                path.dirname(relativePath),
                hashedAsset.hashedFileName
            )

            await atomicWriteBuffer(hashedTargetPath, hashedAsset.content)
            this.assetMap[path.basename(assetPath)] = hashedAsset.hashedFileName
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
            let compiledHtml = await this.engine.render(rawContent, data)
            compiledHtml = rewriteAssetUrls(compiledHtml, this.assetMap)

            const targetPath = path.join(this.outputDir, 'index.html')
            await atomicWriteFile(targetPath, compiledHtml)
            count = 1
        } else if (routePattern.includes(':')) {
            routeType = 'Dynamic (SSG)'
            const baseDir = routePattern.split('/:')[0].replace(/^\//, '')
            const templateCandidates = [
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

            const paths = routeConfig.generatePaths ? await routeConfig.generatePaths() : []
            for (const item of paths) {
                const paramValue = item.params.id || item.params.slug
                let compiledHtml = await this.engine.render(rawContent, item.data || {})
                compiledHtml = rewriteAssetUrls(compiledHtml, this.assetMap)

                const targetPath = path.join(this.outputDir, baseDir, paramValue, 'index.html')
                await atomicWriteFile(targetPath, compiledHtml)
                count++
            }
        } else {
            const routeName = routePattern.replace(/^\//, '')
            const pagePath = path.join(this.srcDir, `${routeName}.html`)
            const data = routeConfig.data ? await routeConfig.data() : {}
            try {
                const rawContent = await fs.readFile(pagePath, 'utf-8')
                let compiledHtml = await this.engine.render(rawContent, data)
                compiledHtml = rewriteAssetUrls(compiledHtml, this.assetMap)

                const targetPath = path.join(this.outputDir, routeName, 'index.html')
                await atomicWriteFile(targetPath, compiledHtml)
                count = 1
            } catch (_) {}
        }

        return { count, routeType, revalidate: revalidateVal }
    }

    async build() {
        console.log(`[Staticraft Builder] Starting build...`)
        const startTime = Date.now()

        await this.loadConfig()
        await fs.rm(this.outputDir, { recursive: true, force: true })
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
            let compiledHtml = await this.engine.render(rawContent, {})
            compiledHtml = rewriteAssetUrls(compiledHtml, this.assetMap)

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
