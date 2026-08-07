import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Compute short 8-character SHA256 hash of content
 */
export function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)
}

/**
 * Reads asset file, generates hashed output filename
 */
export async function generateHashedAsset(filePath) {
    const content = await fs.readFile(filePath)
    const hash = hashContent(content)
    const ext = path.extname(filePath)
    const baseName = path.basename(filePath, ext)
    const dirName = path.dirname(filePath)

    const hashedFileName = `${baseName}.${hash}${ext}`
    const hashedPath = path.join(dirName, hashedFileName)

    return {
        originalPath: filePath,
        originalName: path.basename(filePath),
        hash,
        hashedFileName,
        hashedPath,
        content,
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rewrites asset URLs in HTML using an asset map, prefixing with basePath if specified
 */
export function rewriteAssetUrls(html, assetMap, basePath = '') {
    let updatedHtml = html
    const cleanBasePath = basePath ? basePath.replace(/\/+$/, '') : ''
    const sortedEntries = Object.entries(assetMap).sort((a, b) => b[0].length - a[0].length)
    for (const [originalName, hashedName] of sortedEntries) {
        const escapedName = escapeRegex(originalName)
        const regex = new RegExp(`(["'/])(${escapedName})(["'?#])`, 'g')
        updatedHtml = updatedHtml.replace(regex, (match, p1, p2, p3, offset, fullStr) => {
            const cleanHashed = hashedName.replace(/^\//, '')
            if (p1 === '/') {
                const prefix = fullStr.slice(0, offset)
                if (cleanBasePath && prefix.endsWith(cleanBasePath)) {
                    return `/${cleanHashed}${p3}`
                }
                const target = cleanBasePath ? `${cleanBasePath}/${cleanHashed}` : cleanHashed
                return `/${target.replace(/^\//, '')}${p3}`
            }
            const target = cleanBasePath ? `${cleanBasePath}/${cleanHashed}` : cleanHashed
            return `${p1}${target}${p3}`
        })
    }
    return updatedHtml
}

/**
 * Prefixes root-relative URLs in href and src attributes with basePath (if not already prefixed).
 */
export function rewriteBasePaths(html, basePath = '') {
    if (!basePath) return html
    const cleanBasePath = basePath.replace(/\/+$/, '')
    if (!cleanBasePath) return html

    const regex = /(href|src|content)=(["'])\/([^"']*)\2/g
    return html.replace(regex, (match, attr, quote, rest) => {
        const fullPath = '/' + rest
        if (
            fullPath === cleanBasePath ||
            fullPath.startsWith(cleanBasePath + '/') ||
            fullPath.startsWith(cleanBasePath + '?') ||
            fullPath.startsWith(cleanBasePath + '#') ||
            fullPath.startsWith('//')
        ) {
            return match
        }
        return `${attr}=${quote}${cleanBasePath}${fullPath}${quote}`
    })
}

