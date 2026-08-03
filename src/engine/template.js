import fs from 'node:fs/promises'
import path from 'node:path'
import { rewriteAssetUrls } from './hashing.js'

/**
 * Contextual HTML Escaping for XSS protection
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) return ''
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/`/g, '&#96;')
        .replace(/=/g, '&#61;')
}

/**
 * Resolves nested object properties (e.g. "user.profile.name") with fallback to parent scope
 */
function resolveProperty(obj, pathStr, fallbackObj = null) {
    const parts = pathStr.trim().split('.')
    let current = obj
    let found = true
    for (const part of parts) {
        if (current === null || current === undefined || typeof current !== 'object' || !(part in current)) {
            found = false
            break
        }
        current = current[part]
    }
    if (found && current !== undefined) return current

    if (fallbackObj && typeof fallbackObj === 'object') {
        let fallbackCurrent = fallbackObj
        for (const part of parts) {
            if (fallbackCurrent === null || fallbackCurrent === undefined || typeof fallbackCurrent !== 'object' || !(part in fallbackCurrent)) {
                return undefined
            }
            fallbackCurrent = fallbackCurrent[part]
        }
        return fallbackCurrent
    }

    return undefined
}

/**
 * Zero-dependency HTML Template Engine
 */
export class TemplateEngine {
    constructor(options = {}) {
        this.rootDir = options.rootDir || process.cwd()
        this.templatesDir =
            options.templatesDir || path.join(this.rootDir, 'src')
    }

    /**
     * Process component includes: {{ component "path/to/comp.html" }}
     */
    async processComponents(content, depth = 0) {
        if (depth > 10)
            throw new Error(
                '[Staticraft Engine] Max component nesting depth exceeded',
            )

        const absTemplatesDir = path.resolve(this.templatesDir)
        const componentRegex = /\{\{\s*component\s+["']([^"']+)["']\s*\}\}/g
        let match
        let result = content

        while ((match = componentRegex.exec(content)) !== null) {
            const fullTag = match[0]
            const compPath = match[1]
            const fullPath = path.resolve(this.templatesDir, compPath)

            if (fullPath !== absTemplatesDir && !fullPath.startsWith(absTemplatesDir + path.sep)) {
                console.warn(`[Staticraft Engine] Forbidden component path: ${compPath}`)
                result = result.replace(fullTag, () => `<!-- Forbidden component: ${compPath} -->`)
                continue
            }

            try {
                let compContent = await fs.readFile(fullPath, 'utf-8')
                compContent = await this.processComponents(
                    compContent,
                    depth + 1,
                )
                result = result.replace(fullTag, () => compContent)
            } catch (err) {
                console.warn(
                    `[Staticraft Engine] Component missing: ${compPath}`,
                )
                result = result.replace(
                    fullTag,
                    () => `<!-- Missing component: ${compPath} -->`,
                )
            }
        }

        return result
    }

    /**
     * Process Layout inheritance: {{ layout "layouts/base.html" }}
     */
    async processLayout(content) {
        const layoutRegex = /\{\{\s*layout\s+["']([^"']+)["']\s*\}\}/
        const match = content.match(layoutRegex)

        if (!match) return content

        const layoutTag = match[0]
        const layoutPath = match[1]
        const absTemplatesDir = path.resolve(this.templatesDir)
        const fullPath = path.resolve(this.templatesDir, layoutPath)

        const pageBody = content.replace(layoutTag, '')

        if (fullPath !== absTemplatesDir && !fullPath.startsWith(absTemplatesDir + path.sep)) {
            console.warn(`[Staticraft Engine] Forbidden layout path: ${layoutPath}`)
            return pageBody
        }

        try {
            let layoutContent = await fs.readFile(fullPath, 'utf-8')
            if (layoutContent.includes('{{ slot }}')) {
                return layoutContent.replace('{{ slot }}', () => pageBody)
            } else if (layoutContent.includes('{{ body }}')) {
                return layoutContent.replace('{{ body }}', () => pageBody)
            } else {
                return layoutContent + pageBody
            }
        } catch (err) {
            console.warn(`[Staticraft Engine] Layout missing: ${layoutPath}`)
            return pageBody
        }
    }

    /**
     * Evaluate simple conditionals: {{#if var}}...{{/if}}
     */
    processConditionals(content, data) {
        const ifRegex = /\{\{#if\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g
        return content.replace(ifRegex, (match, conditionVar, innerContent) => {
            const value = resolveProperty(data, conditionVar)
            return value ? innerContent : ''
        })
    }

    /**
     * Evaluate array loops: {{#each list}}...{{/each}}
     */
    processLoops(content, data, assetMap = null) {
        const eachRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g
        return content.replace(eachRegex, (match, arrayPath, itemTemplate) => {
            const list = resolveProperty(data, arrayPath)
            if (!Array.isArray(list) || list.length === 0) return ''

            return list.map((item) => {
                let itemScope = {}
                if (typeof item === 'object' && item !== null) {
                    itemScope = { ...data, ...item }
                } else {
                    itemScope = { ...data, this: item }
                }
                let itemHtml = itemTemplate
                itemHtml = this.processLoops(itemHtml, itemScope, assetMap)
                itemHtml = this.processConditionals(itemHtml, itemScope)
                if (assetMap) itemHtml = rewriteAssetUrls(itemHtml, assetMap)
                itemHtml = this.processVariables(itemHtml, itemScope)
                return itemHtml
            }).join('')
        })
    }

    /**
     * Interpolate variables: {{ title }} or {{{ rawHtml }}}
     */
    processVariables(content, data) {
        // Unescaped variables: {{{ raw }}}
        content = content.replace(
            /\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}/g,
            (match, varPath) => {
                const val = resolveProperty(data, varPath)
                return val !== undefined ? String(val) : ''
            },
        )

        // Escaped variables: {{ title }}
        content = content.replace(
            /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
            (match, varPath) => {
                const val = resolveProperty(data, varPath)
                return val !== undefined ? escapeHtml(val) : ''
            },
        )

        return content
    }

    /**
     * Compile template file or string into final HTML
     */
    async render(templateContent, data = {}, assetMap = null) {
        let html = await this.processLayout(templateContent)
        html = await this.processComponents(html)
        html = this.processLoops(html, data, assetMap)
        html = this.processConditionals(html, data)
        if (assetMap) html = rewriteAssetUrls(html, assetMap)
        html = this.processVariables(html, data)
        return html
    }
}
