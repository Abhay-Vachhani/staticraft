import fs from 'node:fs/promises'
import { parseArgs } from 'node:util'
import path from 'node:path'
import { SiteBuilder } from './worker/builder.js'
import { DevServer } from './dev/server.js'
import { ScheduleManager } from './worker/schedule.js'
import { runInit } from './init.js'

export const VERSION = '0.1.0'

export function showBanner() {
    console.log(`
  ___ _____ _ _____ ___ ___ ___    _   ___ _____ 
 / __|_   _/_\\_   _|_ _/ __| _ \\  /_\\ | __|_   _|  Staticraft v${VERSION}
 \\__ \\ | |/ _ \\| |  | | (__|   / / _ \\| _|  | |    Generate privately.
 |___/ |_/_/ \\_\\_| |___\\___|_|_\\/_/ \\_\\_|   |_|    Serve statically.
                                                   Update continuously.
    `)
}

export function parseCliArgs(args = process.argv.slice(2)) {
    const firstArg = args[0]
    let command = 'help'
    let rawOptions = args

    if (firstArg && !firstArg.startsWith('-')) {
        command = firstArg
        rawOptions = args.slice(1)
    }

    try {
        const { values, positionals } = parseArgs({
            args: rawOptions,
            options: {
                port: { type: 'string', short: 'p', default: '4455' },
                host: { type: 'boolean', short: 'H', default: false },
                help: { type: 'boolean', short: 'h', default: false },
                yes: { type: 'boolean', short: 'y', default: false },
                'site-url': { type: 'string', short: 'u', default: '' }
            },
            allowPositionals: true,
            strict: false
        })

        return {
            command: values.help ? 'help' : command,
            targetDir: positionals[0] || '',
            port: parseInt(values.port, 10) || 4455,
            host: Boolean(values.host),
            help: Boolean(values.help),
            yes: Boolean(values.yes),
            siteUrl: values['site-url'] || ''
        }
    } catch (err) {
        return { command: 'help', targetDir: '', port: 4455, host: false, help: true, yes: false, siteUrl: '' }
    }
}

export async function runCli(args = process.argv.slice(2)) {
    const options = parseCliArgs(args)
    const builder = new SiteBuilder()

    switch (options.command) {
        case 'init':
            showBanner()
            await runInit(options)
            break

        case 'dev':
            showBanner()
            const devServer = new DevServer({
                port: options.port,
                host: options.host
            })
            await devServer.start(builder)
            break

        case 'start':
            showBanner()
            console.log(`[Staticraft] Starting production background worker (0 public HTTP ports open)...`)
            await builder.loadConfig()

            // Check if output directory already exists and contains files
            let raftExists = false
            try {
                const files = await fs.readdir(builder.outputDir)
                if (files.length > 0) raftExists = true
            } catch (_) {}

            if (raftExists) {
                console.log(`[Staticraft] Found existing .raft/ build output. Skipping initial build.\n`)
                await builder.processAssets()
            } else {
                console.log(`[Staticraft] No existing build output found. Running initial build...\n`)
                await builder.build()
            }

            const schedule = new ScheduleManager(builder)
            schedule.start()
            break

        case 'build':
            showBanner()
            await builder.build()
            break

        case 'help':
        default:
            showBanner()
            console.log(`Usage: staticraft <command> [options]

Commands:
  init [dir]        Scaffold a new Staticraft starter project interactively
  dev               Start dev server with HTTP preview (default port: 4455)
  start             Run production background worker daemon (NO HTTP server)
  build             One-shot build: compile static files to .raft/ and exit

Options:
  -p, --port <num>  Set custom development server port (default: 4455)
  -H, --host        Bind development server to 0.0.0.0 for LAN access
  -y, --yes         Skip interactive prompts during init and use defaults
  -u, --site-url    Set site URL during init (e.g. https://example.com)
  -h, --help        Display help menu
            `)
            break
    }
}
