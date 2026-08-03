/**
 * Staticraft Project Configuration
 * Global build settings. Routes are file-based: put a `page.html` in a
 * folder under src/app/ to define a route, with an optional sibling `server.js`
 * exporting { data, generatePaths, revalidate }. See src/app/products/ for examples.
 */

export default {
    outputDir: '.raft',
    defaultExpiry: '1y', // Default expiry (1 year)
    siteUrl: 'https://kraft.example.com', // Used to generate sitemap.xml; omit to skip it
}
