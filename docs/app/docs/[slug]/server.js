export default {
    generatePaths: async () => [
        {
            params: { slug: 'getting-started' },
            data: {
                slug: 'getting-started',
                title: 'Getting Started with Staticraft',
                badge: 'Quickstart',
                readTime: '3 min read',
                description: 'A complete step-by-step guide to installing Staticraft, creating your first security-first project, understanding the folder structure, and running local development.',
                prev: null,
                next: { slug: 'routing-and-data', title: 'File-Based Routing & Data Hooks' },
                sections: [
                    {
                        heading: '1. Prerequisites & Node.js Requirement',
                        content: 'Staticraft is built with modern Node.js standard libraries (ES modules, node:fs/promises, node:http). Make sure you have Node.js version 18.0.0 or higher installed.\n\nVerify your installed Node version with:',
                        code: 'node -v\n# Output should be >= v18.0.0'
                    },
                    {
                        heading: '2. Installation Methods',
                        content: 'You can install Staticraft globally via npm or run commands on-demand with npx without installing globally.',
                        code: '# Option A: Global installation\nnpm install -g staticraft\n\n# Option B: Run on-demand using npx\nnpx staticraft dev'
                    },
                    {
                        heading: '3. Understanding Project Directory Architecture',
                        content: 'Staticraft enforces clean separation between source files (`src/app/`) and compiled artifacts (`.raft/`). All templates, controllers, and static assets live inside `src/app/`:',
                        code: 'my-staticraft-site/\n├── staticraft.config.js       # Main project settings (siteUrl, outputDir)\n├── package.json\n└── src/\n    └── app/\n        ├── page.html           # Home page template (Mapped to /)\n        ├── server.js           # Home page data hook & revalidate timer\n        ├── 404.html            # Custom error page fallback\n        ├── styles.css          # Stylesheets (automatically hashed)\n        └── docs/\n            ├── page.html       # Documentation index (Mapped to /docs)\n            └── server.js       # Data controller for /docs'
                    },
                    {
                        heading: '4. Launching the Local Dev Server',
                        content: 'Run `staticraft dev` inside your project directory. Staticraft spins up a fast development server with live reload and automatic file watching on `http://localhost:4455/`.',
                        code: 'staticraft dev\n\n# Custom port override:\nstaticraft dev --port 5000'
                    }
                ]
            }
        },
        {
            params: { slug: 'routing-and-data' },
            data: {
                slug: 'routing-and-data',
                title: 'File-Based Routing & Data Hooks',
                badge: 'Core Concepts',
                readTime: '5 min read',
                description: 'Learn how Staticraft maps files to HTTP paths, fetches dynamic data via server.js hooks, manages background revalidation timers, and statically pre-renders dynamic SSG routes.',
                prev: { slug: 'getting-started', title: 'Getting Started with Staticraft' },
                next: { slug: 'template-engine', title: 'Template Engine Syntax' },
                sections: [
                    {
                        heading: '1. File-Based Route Mapping',
                        content: 'Staticraft uses filesystem conventions to discover pages. Any `page.html` located under `src/app/` automatically establishes a route pattern:',
                        code: 'src/app/page.html               -> /\nsrc/app/about/page.html         -> /about\nsrc/app/blog/page.html          -> /blog\nsrc/app/blog/[slug]/page.html    -> /blog/:slug'
                    },
                    {
                        heading: '2. Colocated server.js Data Hook',
                        content: 'To attach dynamic data to a page, place a `server.js` file next to `page.html`. Export a default object containing a `data()` async function.',
                        code: '// src/app/page.js\nexport default {\n    revalidate: 600,\n    data: async () => {\n        const response = await fetch("https://api.example.com/stats");\n        const stats = await response.json();\n        return {\n            title: "Dashboard Overview",\n            stats\n        };\n    }\n};'
                    },
                    {
                        heading: '3. Background Revalidation Timers',
                        content: 'The `revalidate` property specifies how often Staticraft ScheduleManager re-fetches data and re-renders the page in the background.\n\n- `revalidate: 60` -> Refresh every 1 minute\n- `revalidate: 3600` -> Refresh every 1 hour\n- Unspecified / omitted -> Permanent static page (rendered once)',
                        code: 'export default {\n    revalidate: 300 // Re-renders in background every 5 minutes\n};'
                    },
                    {
                        heading: '4. Dynamic SSG Routes with generatePaths()',
                        content: 'For dynamic routes like `src/app/blog/[slug]/page.html`, export `generatePaths()` from `server.js`. This returns an array of param objects and associated page data to pre-render every page statically.',
                        code: '// src/app/blog/[slug]/server.js\nexport default {\n    revalidate: 1800,\n    generatePaths: async () => [\n        {\n            params: { slug: "welcome-to-staticraft" },\n            data: { title: "Welcome to Staticraft", author: "Abhay Vachhani" }\n        },\n        {\n            params: { slug: "zero-port-architecture" },\n            data: { title: "Zero-Port Architecture", author: "Abhay Vachhani" }\n        }\n    ]\n};'
                    }
                ]
            }
        },
        {
            params: { slug: 'template-engine' },
            data: {
                slug: 'template-engine',
                title: 'Template Engine Syntax',
                badge: 'Templating',
                readTime: '4 min read',
                description: 'Master Staticraft zero-dependency template engine syntax, layout inheritance, slot injection, component partials, loops, conditionals, and automatic XSS escaping.',
                prev: { slug: 'routing-and-data', title: 'File-Based Routing & Data Hooks' },
                next: { slug: 'deployment-and-security', title: 'Zero-Port Deployment & Nginx Setup' },
                sections: [
                    {
                        heading: '1. Layout Inheritance & {{ slot }} Injection',
                        content: 'Define a shared master layout in `src/app/layouts/base.html` containing common HTML head elements, headers, and footers. Child pages reference the layout using `{{ layout "layouts/base.html" }}`. Page contents are automatically injected into `{{ slot }}`.',
                        code: '<!-- src/app/layouts/base.html -->\n<!DOCTYPE html>\n<html>\n<head><title>&#123;&#123; title &#125;&#125;</title></head>\n<body>\n    <header>Site Header</header>\n    <main>&#123;&#123; slot &#125;&#125;</main>\n</body>\n</html>\n\n<!-- src/app/page.html -->\n&#123;&#123; layout "layouts/base.html" &#125;&#125;\n<h1>Welcome to &#123;&#123; title &#125;&#125;</h1>'
                    },
                    {
                        heading: '2. Reusable Components & Partials',
                        content: 'Break modular UI components into clean template files and include them using `{{ component "components/navbar.html" }}`.',
                        code: '&#123;&#123; component "components/navbar.html" &#125;&#125;\n<section>Content Here</section>\n&#123;&#123; component "components/footer.html" &#125;&#125;'
                    },
                    {
                        heading: '3. Conditionals ({{#if}})',
                        content: 'Evaluate boolean or object presence conditionally with `{{#if variable}}...{{/if}}`.',
                        code: '&#123;&#123;#if isFeatured&#125;&#125;\n    <span class="badge">Featured Post</span>\n&#123;&#123;/if&#125;&#125;'
                    },
                    {
                        heading: '4. Array Loops ({{#each}})',
                        content: 'Iterate over lists using `{{#each items}}...{{/each}}`. Object properties inside the array are exposed directly in scope.',
                        code: '<ul>\n&#123;&#123;#each features&#125;&#125;\n    <li>\n        <strong>&#123;&#123; title &#125;&#125;</strong> - &#123;&#123; description &#125;&#125;\n    </li>\n&#123;&#123;/each&#125;&#125;\n</ul>'
                    },
                    {
                        heading: '5. Variable Escaping & Asset Fingerprinting',
                        content: 'By default, `{{ variable }}` applies contextual XSS HTML escaping. Use `{{{ rawHtml }}}` for unescaped HTML interpolation.\n\nAll non-HTML static assets (CSS, JS, images) are automatically hashed (e.g., `styles.07eef7b1.css`) and rewritten across templates. To keep specific assets unhashed (such as favicons or Open Graph social images), specify `ignoreHash: ["favicon.png", "og-image.png"]` in `staticraft.config.js`.',
                        code: '<link rel="stylesheet" href="/styles.css">\n<!-- Transformed automatically into: -->\n<link rel="stylesheet" href="/styles.07eef7b1.css">'
                    }
                ]
            }
        },
        {
            params: { slug: 'deployment-and-security' },
            data: {
                slug: 'deployment-and-security',
                title: 'Zero-Port Deployment & Nginx Setup',
                badge: 'Security & DevOps',
                readTime: '6 min read',
                description: 'Deploy Staticraft in production using zero exposed application ports, Nginx static file serving, systemd service management, and atomic POSIX swaps.',
                prev: { slug: 'template-engine', title: 'Template Engine Syntax' },
                next: null,
                sections: [
                    {
                        heading: '1. Production Generator Mode (staticraft start)',
                        content: 'In production, run `staticraft start`. The worker daemon runs in an isolated private environment without opening any public HTTP ports. It pulls data, renders HTML, and performs atomic file swaps into `.raft/`.',
                        code: 'staticraft start'
                    },
                    {
                        heading: '2. Atomic POSIX Swaps (rename(2))',
                        content: 'Staticraft writes compiled HTML to staging temporary files before executing an atomic `rename(2)` system call to replace the target file in `.raft/`. This ensures web servers like Nginx never serve partially rendered files or encounter torn reads.',
                        code: '[Staging File] -> atomic rename(2) -> .raft/index.html'
                    },
                    {
                        heading: '3. Nginx Production Configuration',
                        content: 'Point Nginx directly to the `.raft/` output folder for maximum static delivery throughput:',
                        code: 'server {\n    listen 80;\n    server_name staticraft.dev;\n    root /var/www/staticraft-website/.raft;\n    index index.html;\n\n    # Immutable caching for hashed assets\n    location ~* \\.[a-f0-9]{8}\\.(css|js|png|jpg)$ {\n        expires 1y;\n        add_header Cache-Control "public, immutable";\n    }\n\n    # Fallback static page routing\n    location / {\n        try_files $uri $uri/ /index.html =404;\n    }\n\n    # Custom 404 page handling\n    error_page 404 /404.html;\n}'
                    },
                    {
                        heading: '4. Systemd Background Worker Service',
                        content: 'Create a systemd unit file to keep `staticraft start` running as a background service on Linux servers:',
                        code: '# /etc/systemd/system/staticraft.service\n[Unit]\nDescription=Staticraft Background Site Engine\nAfter=network.target\n\n[Service]\nType=simple\nUser=deploy\nWorkingDirectory=/var/www/staticraft-website\nExecStart=/usr/local/bin/staticraft start\nRestart=always\n\n[Install]\nWantedBy=multi-user.target'
                    }
                ]
            }
        }
    ]
}
