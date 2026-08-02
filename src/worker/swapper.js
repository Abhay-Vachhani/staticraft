import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * Safely writes content to a target file using POSIX atomic rename(2).
 *
 * 1. Creates parent directory if it does not exist.
 * 2. Writes to a hidden staging file on the exact same directory/filesystem.
 * 3. Atomically replaces target file using fs.rename.
 */
export async function atomicWriteFile(targetPath, content) {
    const dir = path.dirname(targetPath)
    await fs.mkdir(dir, { recursive: true })

    const nonce = crypto.randomBytes(4).toString('hex')
    const tmpPath = path.join(
        dir,
        `.${path.basename(targetPath)}.tmp.${Date.now()}.${nonce}`,
    )

    try {
        await fs.writeFile(tmpPath, content, 'utf-8')
        await fs.rename(tmpPath, targetPath)
    } catch (err) {
        try {
            await fs.unlink(tmpPath)
        } catch (_) {}
        throw err
    }
}

/**
 * Safely writes binary buffer to a target file using POSIX atomic rename(2).
 */
export async function atomicWriteBuffer(targetPath, buffer) {
    const dir = path.dirname(targetPath)
    await fs.mkdir(dir, { recursive: true })

    const nonce = crypto.randomBytes(4).toString('hex')
    const tmpPath = path.join(
        dir,
        `.${path.basename(targetPath)}.tmp.${Date.now()}.${nonce}`,
    )

    try {
        await fs.writeFile(tmpPath, buffer)
        await fs.rename(tmpPath, targetPath)
    } catch (err) {
        try {
            await fs.unlink(tmpPath)
        } catch (_) {}
        throw err
    }
}
