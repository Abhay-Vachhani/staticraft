import fs from 'node:fs/promises'
import path from 'node:path'
import { rewriteAssetUrls, rewriteBasePaths } from './hashing.js'

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
        .replace(/\{/g, '&#123;')
        .replace(/\}/g, '&#125;')
}

const DISALLOWED_PROPS = new Set(['__proto__', 'constructor', 'prototype'])

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolves nested object properties (e.g. "user.profile.name") with fallback to parent scope
 */
function resolveProperty(obj, pathStr, fallbackObj = null) {
    if (!pathStr || typeof pathStr !== 'string') return undefined
    const parts = pathStr.trim().split('.')
    for (const part of parts) {
        if (DISALLOWED_PROPS.has(part)) return undefined
    }

    const getVal = (target) => {
        let current = target
        for (const part of parts) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return { found: false }
            }
            if (!Object.hasOwn(current, part)) {
                return { found: false }
            }
            current = current[part]
        }
        return { found: true, val: current }
    }

    const primary = getVal(obj)
    if (primary.found && primary.val !== undefined) return primary.val

    if (fallbackObj && typeof fallbackObj === 'object') {
        const fallback = getVal(fallbackObj)
        if (fallback.found && fallback.val !== undefined) return fallback.val
    }

    return undefined
}

function findBlockMatch(content, openRegex, closeTag) {
    const match = openRegex.exec(content)
    if (!match) return null

    const openTag = match[0]
    const param = match[1]
    const startIndex = match.index
    let depth = 1
    let currentIndex = startIndex + openTag.length

    const nonCapturingOpenPattern = openRegex.source.replace(/\((?!\?:)/g, '(?:')
    const tokenRegex = new RegExp(`(?:${nonCapturingOpenPattern})|(?:${escapeRegex(closeTag)})`, 'g')
    tokenRegex.lastIndex = currentIndex

    let tokenMatch
    while ((tokenMatch = tokenRegex.exec(content)) !== null) {
        const token = tokenMatch[0]
        if (token === closeTag) {
            depth--
            if (depth === 0) {
                const matchEnd = tokenRegex.lastIndex
                const innerContent = content.slice(currentIndex, tokenMatch.index)
                return {
                    fullMatch: content.slice(startIndex, matchEnd),
                    openTag,
                    param,
                    innerContent,
                    startIndex,
                    endIndex: matchEnd
                }
            }
        } else {
            depth++
        }
    }
    return null
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
     * Evaluate simple conditionals: {{#if var}}...{{else}}...{{/if}}
     */
    processConditionals(content, data) {
        let result = content
        const openRegex = /\{\{#if\s+([a-zA-Z0-9_.]+)\}\}/
        let block
        while ((block = findBlockMatch(result, openRegex, '{{/if}}')) !== null) {
            const value = resolveProperty(data, block.param)
            const parts = block.innerContent.split(/\{\{#?else\}\}/)
            const truthyContent = parts[0]
            const falsyContent = parts.length > 1 ? parts.slice(1).join('{{else}}') : ''
            const chosen = value ? truthyContent : falsyContent
            const replacement = this.processConditionals(chosen, data)
            result = result.slice(0, block.startIndex) + replacement + result.slice(block.endIndex)
        }
        return result
    }

    /**
     * Evaluate array loops: {{#each list}}...{{/each}}
     */
    processLoops(content, data, assetMap = null, basePath = '') {
        let result = content
        const openRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\}\}/
        let block
        while ((block = findBlockMatch(result, openRegex, '{{/each}}')) !== null) {
            const list = resolveProperty(data, block.param)
            let replacement = ''
            if (Array.isArray(list) && list.length > 0) {
                replacement = list.map((item) => {
                    let itemScope = {}
                    if (typeof item === 'object' && item !== null) {
                        itemScope = { ...data, ...item }
                    } else {
                        itemScope = { ...data, this: item }
                    }
                    let itemHtml = block.innerContent
                    itemHtml = this.processLoops(itemHtml, itemScope, assetMap, basePath)
                    itemHtml = this.processConditionals(itemHtml, itemScope)
                    if (assetMap) itemHtml = rewriteAssetUrls(itemHtml, assetMap, basePath)
                    if (basePath) itemHtml = rewriteBasePaths(itemHtml, basePath)
                    itemHtml = this.processVariables(itemHtml, itemScope)
                    return itemHtml
                }).join('')
            }
            result = result.slice(0, block.startIndex) + replacement + result.slice(block.endIndex)
        }
        return result
    }

    /**
     * Interpolate variables: {{ title }} or {{{ rawHtml }}}
     */
    processVariables(content, data) {
        const varRegex = /\{\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\}|\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g
        return content.replace(varRegex, (match, rawPath, escapedPath) => {
            if (rawPath) {
                const val = resolveProperty(data, rawPath)
                return val !== undefined ? String(val) : ''
            }
            if (escapedPath) {
                const val = resolveProperty(data, escapedPath)
                return val !== undefined ? escapeHtml(val) : ''
            }
            return ''
        })
    }

    /**
     * Compile template file or string into final HTML
     */
    async render(templateContent, data = {}, assetMap = null, basePath = '') {
        let html = await this.processLayout(templateContent)
        html = await this.processComponents(html)
        html = this.processLoops(html, data, assetMap, basePath)
        html = this.processConditionals(html, data)
        if (assetMap) html = rewriteAssetUrls(html, assetMap, basePath)
        if (basePath) html = rewriteBasePaths(html, basePath)
        html = this.processVariables(html, data)
        return html
    }
}
