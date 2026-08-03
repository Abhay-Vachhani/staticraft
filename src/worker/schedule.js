import { formatDuration } from './builder.js'

export const DEFAULT_EXPIRY_SECONDS = 31536000 // 1 Year

export class ScheduleManager {
    constructor(builder) {
        this.builder = builder
        this.timers = []
        this.running = false
    }

    start() {
        if (this.running) return
        this.running = true
        console.log(`[Staticraft Schedule] Active revalidation timers from discovered routes:`)

        const routes = this.builder.routes || {}
        for (const [routePattern, routeEntry] of Object.entries(routes)) {
            const { mod } = routeEntry
            if (mod.revalidate) {
                const intervalMs = mod.revalidate * 1000
                console.log(`   > Route ${routePattern}: Revalidates every ${formatDuration(mod.revalidate)}`)

                const timer = setInterval(async () => {
                    if (!this.running) return
                    console.log(`[Staticraft Schedule] Invalidation timer triggered for ${routePattern} (${formatDuration(mod.revalidate)})`)
                    try {
                        await this.builder.buildRoute(routePattern, routeEntry)
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
