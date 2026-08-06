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
            staticraft: '^0.1.2'
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
    <div class="glow-bg"></div>
    
    <div class="layout">
        <header class="navbar">
            <div class="brand">
                <svg class="brand-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-2 10h8L7 22l2-10H1z"/></svg>
                <span class="brand-name">Staticraft</span>
            </div>
            <span class="badge">v0.1.2</span>
        </header>

        <main class="hero">
            <h1 class="title">{{ title }}</h1>
            <p class="subtitle">{{ description }}</p>

            <div class="cta-group">
                <a href="https://github.com/abhay-Vachhani/staticraft/" target="_blank" rel="noopener" class="btn btn-primary">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path><path d="M9 18c-4.51 2-5-2-7-2"></path></svg>
                    <span>GitHub</span>
                </a>
                <a href="https://npmjs.com/package/staticraft" target="_blank" rel="noopener" class="btn btn-outline">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16.5 9.4-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><line x1="12" y1="22" x2="12" y2="12"></line></svg>
                    <span>npm Package</span>
                </a>
            </div>
        </main>

        <section class="grid">
            {{#each features}}
            <div class="card">
                <div class="card-tag">{{ tag }}</div>
                <h2 class="card-title">{{ title }}</h2>
                <p class="card-text">{{ description }}</p>
            </div>
            {{/each}}
        </section>

        <footer class="footer">
            <p>&copy; <span id="copyright-year">2026</span> Powered by <a href="https://github.com/abhay-Vachhani/staticraft/" target="_blank" rel="noopener">Staticraft</a></p>
            <script>(function(){var el=document.getElementById('copyright-year');if(el)el.textContent=new Date().getFullYear();})();</script>
        </footer>
    </div>
</body>
</html>
`
    await fs.writeFile(path.join(appDir, 'page.html'), pageHtml, 'utf-8')

    const serverJs = `export default {
    revalidate: 600,
    data: async () => ({
        title: 'Welcome to Staticraft',
        description: 'Generate privately. Serve statically. Update continuously.',
        features: [
            {
                tag: 'Security',
                title: 'Private Generation',
                description: 'Pre-build pages safely behind firewalls with zero public HTTP attack surface.'
            },
            {
                tag: 'Performance',
                title: 'Static Speed',
                description: 'Blazing fast sub-millisecond edge responses with pure static HTML/CSS delivery.'
            },
            {
                tag: 'Automation',
                title: 'Continuous Revalidation',
                description: 'Background worker dynamically revalidates stale content on configurable schedules.'
            }
        ]
    }),
}
`
    await fs.writeFile(path.join(appDir, 'server.js'), serverJs, 'utf-8')

    const stylesCss = `:root {
    --bg: #090a0f;
    --panel-bg: rgba(17, 20, 29, 0.75);
    --card-bg: rgba(255, 255, 255, 0.025);
    --border: rgba(255, 255, 255, 0.08);
    --border-hover: rgba(229, 193, 88, 0.35);
    --text: #f8fafc;
    --text-muted: #94a3b8;
    --accent: #e5c158;
    --accent-glow: rgba(229, 193, 88, 0.12);
    --tag-bg: rgba(229, 193, 88, 0.1);
}

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    overflow-x: hidden;
}

.glow-bg {
    position: absolute;
    top: 20%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 650px;
    height: 650px;
    background: radial-gradient(circle, var(--accent-glow) 0%, rgba(9, 10, 15, 0) 70%);
    pointer-events: none;
    z-index: 0;
}

.layout {
    position: relative;
    z-index: 1;
    max-width: 880px;
    width: 90%;
    margin: 3rem auto;
    padding: 2.75rem;
    background: var(--panel-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--border);
    border-radius: 20px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
}

.navbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 3.5rem;
}

.brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--accent);
}

.brand-name {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text);
}

.badge {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    padding: 0.2rem 0.65rem;
    border-radius: 9999px;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 500;
}

.hero {
    text-align: center;
    margin-bottom: 3.5rem;
}

.title {
    font-size: 2.75rem;
    font-weight: 800;
    letter-spacing: -0.03em;
    color: var(--text);
    margin-bottom: 1rem;
    line-height: 1.2;
}

.subtitle {
    font-size: 1.15rem;
    color: var(--text-muted);
    max-width: 580px;
    margin: 0 auto 2.25rem;
    line-height: 1.6;
}

.cta-group {
    display: flex;
    justify-content: center;
    gap: 1rem;
}

.btn {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.75rem 1.5rem;
    border-radius: 10px;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
    transition: all 0.2s ease;
}

.btn-primary {
    background: var(--accent);
    color: #090a0f;
}

.btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 16px rgba(229, 193, 88, 0.35);
}

.btn-outline {
    background: rgba(255, 255, 255, 0.03);
    color: var(--text);
    border: 1px solid var(--border);
}

.btn-outline:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: var(--border-hover);
    transform: translateY(-1px);
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.25rem;
    margin-bottom: 3rem;
}

.card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    padding: 1.5rem;
    border-radius: 14px;
    transition: all 0.2s ease;
}

.card:hover {
    border-color: var(--border-hover);
    transform: translateY(-2px);
}

.card-tag {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
    background: var(--tag-bg);
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.85rem;
}

.card-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 0.4rem;
    color: var(--text);
}

.card-text {
    font-size: 0.88rem;
    color: var(--text-muted);
    line-height: 1.55;
}

.footer {
    text-align: center;
    border-top: 1px solid var(--border);
    padding-top: 1.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
}

.footer a {
    color: var(--accent);
    text-decoration: none;
    font-weight: 500;
}

.footer a:hover {
    text-decoration: underline;
}
`
    await fs.writeFile(path.join(appDir, 'styles.css'), stylesCss, 'utf-8')

    const page404Html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 | Page Not Found</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="glow-bg"></div>
    <div class="layout" style="text-align: center; padding: 4rem 2rem;">
        <span class="card-tag" style="margin-bottom: 1rem;">Error 404</span>
        <h1 class="title" style="font-size: 3rem; margin-bottom: 0.5rem;">Page Not Found</h1>
        <p class="subtitle" style="margin-bottom: 2rem;">The route you requested could not be located in static builds.</p>
        <div class="cta-group">
            <a href="/" class="btn btn-primary">Return Home</a>
            <a href="https://github.com/abhay-Vachhani/staticraft/" target="_blank" rel="noopener" class="btn btn-outline">Documentation</a>
        </div>
    </div>
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
