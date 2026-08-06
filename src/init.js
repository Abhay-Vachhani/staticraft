import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

export async function runInit(options = {}) {
    let targetName = options.targetDir
    let siteUrl = options.siteUrl
    let useSrc = options.useSrc

    if (!options.yes && (!targetName || !siteUrl || useSrc === undefined)) {
        const rl = readline.createInterface({ input, output })
        try {
            if (!targetName) {
                const answer = await rl.question('Project name / directory (my-staticraft-site): ')
                targetName = answer.trim() || 'my-staticraft-site'
            }
            if (!siteUrl) {
                const answer = await rl.question('Site URL (optional, e.g. https://example.com): ')
                siteUrl = answer.trim() || 'https://example.com'
            }
            if (useSrc === undefined) {
                const answer = await rl.question("Would you like to use 'src/' directory? (y/N): ")
                const trimmed = answer.trim().toLowerCase()
                useSrc = trimmed === 'y' || trimmed === 'yes'
            }
        } finally {
            rl.close()
        }
    } else {
        if (!targetName) targetName = 'my-staticraft-site'
        if (!siteUrl) siteUrl = 'https://example.com'
        if (useSrc === undefined) useSrc = false
    }

    const targetDir = path.resolve(process.cwd(), targetName)
    const folderName = path.basename(targetDir)

    try {
        const files = await fs.readdir(targetDir)
        if (files.length > 0) {
            console.warn(`[Staticraft Init Warning] Target directory "${targetName}" is not empty. Files may be overwritten.`)
        }
    } catch (_) {
        await fs.mkdir(targetDir, { recursive: true })
    }

    const packageJson = {
        name: folderName.toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
            dev: 'staticraft dev',
            build: 'staticraft build',
            start: 'staticraft start'
        },
        devDependencies: {
            staticraft: '^0.1.0'
        }
    }
    await fs.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n', 'utf-8')

    const srcDirSetting = useSrc ? 'src/app' : 'app'
    const configContent = `/**
 * Staticraft Project Configuration
 */
export default {
    outputDir: '.raft',
    defaultExpiry: '1y',
    siteUrl: '${siteUrl}',
    srcDir: '${srcDirSetting}',
}
`
    await fs.writeFile(path.join(targetDir, 'staticraft.config.js'), configContent, 'utf-8')
    await fs.writeFile(path.join(targetDir, '.gitignore'), 'node_modules/\n.raft/\n.DS_Store\n', 'utf-8')

    const appDir = useSrc ? path.join(targetDir, 'src', 'app') : path.join(targetDir, 'app')
    await fs.mkdir(appDir, { recursive: true })

    const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ title }}</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <main class="container">
        <h1>⚡ {{ title }}</h1>
        <p>{{ description }}</p>
    </main>
</body>
</html>
`
    await fs.writeFile(path.join(appDir, 'page.html'), pageHtml, 'utf-8')

    const serverJs = `export default {
    revalidate: 600,
    data: async () => ({
        title: 'Welcome to Staticraft',
        description: 'Generate privately. Serve statically. Update continuously.',
    }),
}
`
    await fs.writeFile(path.join(appDir, 'server.js'), serverJs, 'utf-8')

    const stylesCss = `body {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #07080b;
    color: #f1f3f9;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
}
.container {
    text-align: center;
    background: #0e1017;
    padding: 3rem;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}
h1 {
    color: #e5c158;
    margin-bottom: 0.5rem;
}
`
    await fs.writeFile(path.join(appDir, 'styles.css'), stylesCss, 'utf-8')

    const page404Html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 | Page Not Found</title>
</head>
<body>
    <h1>404 Page Not Found</h1>
</body>
</html>
`
    await fs.writeFile(path.join(appDir, '404.html'), page404Html, 'utf-8')

    console.log(`
🎉 Staticraft project successfully initialized at ./${targetName}!

Next steps:
  cd ${targetName}
  npm install
  npm run dev
`)
}
