import path from 'node:path'

export const DEFAULT_EXPIRY_SECONDS = 31536000 // 1 Year

export class ScheduleManager {
    constructor(builder, config = {}) {
        this.builder = builder
        this.config = config
        this.timers = []
        this.running = false
    }

    start() {
        if (this.running) return
        this.running = true
        console.log(`[Staticraft Schedule] Active revalidation timers from staticraft.config.js:`)

        const routes = this.config.routes || {}
        for (const [routePattern, routeConfig] of Object.entries(routes)) {
            if (routeConfig.revalidate) {
                const intervalMs = routeConfig.revalidate * 1000
                console.log(`   > Route ${routePattern}: Revalidates every ${routeConfig.revalidate}s`)

                const timer = setInterval(async () => {
                    if (!this.running) return
                    console.log(`[Staticraft Schedule] Invalidation timer triggered for ${routePattern} (${routeConfig.revalidate}s)`)
                    try {
                        await this.builder.buildRoute(routePattern, routeConfig)
                    } catch (err) {
                        console.error(`[Staticraft Schedule Error] Route ${routePattern}:`, err.message)
                    }
                }, intervalMs)

                this.timers.push(timer)
            } else {
                console.log(`   > Route ${routePattern}: Permanent (No background expiry timer)`)
            }
        }

        console.log(`   > Default Expiry Header: 1 Year (max-age=${DEFAULT_EXPIRY_SECONDS}, immutable)\n`)
    }

    stop() {
        this.running = false
        for (const timer of this.timers) {
            clearInterval(timer)
        }
        this.timers = []
    }
}
