/**
 * Staticraft Project Configuration
 * User-defined routes, data fetching, and revalidation schedules
 */

export default {
    outputDir: '.raft',
    defaultExpiry: '1y', // Default expiry (1 year)
    routes: {
        '/': {
            revalidate: 600, // 600s = 10 min
            data: async () => {
                try {
                    const res = await fetch(
                        'https://dummyjson.com/products?limit=6',
                    )
                    const json = await res.json()
                    return { products: json.products || [] }
                } catch (err) {
                    return { products: [] }
                }
            },
        },
        '/products': {
            revalidate: 300, // 300s = 5 min
            data: async () => {
                try {
                    const res = await fetch(
                        'https://dummyjson.com/products?limit=1200',
                    )
                    const json = await res.json()
                    return { products: json.products || [] }
                } catch (err) {
                    return { products: [] }
                }
            },
        },
        '/products/:id': {
            revalidate: 3600, // 3600s = 1 hr
            generatePaths: async () => {
                try {
                    const res = await fetch(
                        'https://dummyjson.com/products?limit=1200',
                    )
                    const json = await res.json()
                    return json.products.map((product) => ({
                        params: { id: String(product.id) },
                        data: { product, title: product.title },
                    }))
                } catch (err) {
                    return []
                }
            },
        },
    },
}
