import fs from 'node:fs/promises'
import path from 'node:path'

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
}

/**
 * Resolves nested object properties (e.g. "user.profile.name")
 */
function resolveProperty(obj, pathStr) {
    const parts = pathStr.trim().split('.')
    let current = obj
    for (const part of parts) {
        if (current === null || current === undefined) return undefined
        current = current[part]
    }
    return current
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

        const componentRegex = /\{\{\s*component\s+["']([^"']+)["']\s*\}\}/g
        let match
        let result = content

        while ((match = componentRegex.exec(content)) !== null) {
            const fullTag = match[0]
            const compPath = match[1]
            const fullPath = path.resolve(this.templatesDir, compPath)

            try {
                let compContent = await fs.readFile(fullPath, 'utf-8')
                compContent = await this.processComponents(
                    compContent,
                    depth + 1,
                )
                result = result.replace(fullTag, compContent)
            } catch (err) {
                console.warn(
                    `[Staticraft Engine] Component missing: ${compPath}`,
                )
                result = result.replace(
                    fullTag,
                    `<!-- Missing component: ${compPath} -->`,
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
        const fullPath = path.resolve(this.templatesDir, layoutPath)

        const pageBody = content.replace(layoutTag, '')

        try {
            let layoutContent = await fs.readFile(fullPath, 'utf-8')
            if (layoutContent.includes('{{ slot }}')) {
                return layoutContent.replace('{{ slot }}', pageBody)
            } else if (layoutContent.includes('{{ body }}')) {
                return layoutContent.replace('{{ body }}', pageBody)
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
    processLoops(content, data) {
        const eachRegex = /\{\{#each\s+([a-zA-Z0-9_.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g
        return content.replace(eachRegex, (match, arrayPath, itemTemplate) => {
            const list = resolveProperty(data, arrayPath)
            if (!Array.isArray(list) || list.length === 0) return ''

            return list.map((item) => {
                let itemHtml = itemTemplate
                if (typeof item === 'object' && item !== null) {
                    // Replace item properties inside loop
                    itemHtml = this.processVariables(itemHtml, item)
                } else {
                    itemHtml = itemHtml.replace(/\{\{\s*this\s*\}\}/g, escapeHtml(item))
                }
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
    async render(templateContent, data = {}) {
        let html = await this.processLayout(templateContent)
        html = await this.processComponents(html)
        html = this.processLoops(html, data)
        html = this.processConditionals(html, data)
        html = this.processVariables(html, data)
        return html
    }
}
