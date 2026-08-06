export default {
    data: async () => ({
        title: 'Documentation | Staticraft',
        description: 'Comprehensive guide and API reference for building static sites with Staticraft.',
        guides: [
            {
                slug: 'getting-started',
                title: 'Getting Started with Staticraft',
                badge: 'Quickstart',
                readTime: '3 min read',
                summary: 'Install Staticraft, create your first project, understand the app/ folder architecture, and launch the dev server.'
            },
            {
                slug: 'routing-and-data',
                title: 'File-Based Routing & Data Hooks',
                badge: 'Core Concepts',
                readTime: '5 min read',
                summary: 'Learn file-based route mapping, server.js data hooks, revalidation timers, and dynamic SSG route pre-rendering.'
            },
            {
                slug: 'template-engine',
                title: 'Template Engine Syntax',
                badge: 'Templating',
                readTime: '4 min read',
                summary: 'Master layout inheritance, slot injection, partial components, loops, conditionals, and asset fingerprinting.'
            },
            {
                slug: 'deployment-and-security',
                title: 'Zero-Port Deployment & Nginx Setup',
                badge: 'Security & DevOps',
                readTime: '6 min read',
                summary: 'Deploy in production with zero exposed application ports, POSIX rename(2) atomic swaps, and Nginx caching.'
            }
        ]
    })
}
