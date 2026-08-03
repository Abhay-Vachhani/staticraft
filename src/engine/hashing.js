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
 * Rewrites asset URLs in HTML using an asset map
 */
export function rewriteAssetUrls(html, assetMap) {
    let updatedHtml = html
    for (const [originalName, hashedName] of Object.entries(assetMap)) {
        const escapedName = escapeRegex(originalName)
        const regex = new RegExp(`(["'/])(${escapedName})(["'?#])`, 'g')
        updatedHtml = updatedHtml.replace(regex, `$1${hashedName}$3`)
    }
    return updatedHtml
}
