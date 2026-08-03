import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Materializes a flat { 'relative/path.ext': 'content' } map into a fresh
 * temp directory so tests never touch the real project's src/.raft/config.
 */
export async function createFixture(tree = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'staticraft-test-'))

    for (const [relPath, content] of Object.entries(tree)) {
        const fullPath = path.join(dir, relPath)
        await fs.mkdir(path.dirname(fullPath), { recursive: true })
        await fs.writeFile(fullPath, content)
    }

    return {
        dir,
        cleanup: () => fs.rm(dir, { recursive: true, force: true }),
    }
}
