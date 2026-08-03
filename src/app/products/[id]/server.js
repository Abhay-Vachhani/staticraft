export default {
    revalidate: 3600, // 3600s = 1 hr

    // On-demand rendering: fetch just the requested product by id instead of
    // pulling the entire 1200-item catalog to pick one out.
    data: async ({ params }) => {
        try {
            const res = await fetch(
                `https://dummyjson.com/products/${params.id}`,
            )
            if (!res.ok) return null
            const product = await res.json()
            return { product, title: product.title }
        } catch (err) {
            return null
        }
    },

    // Full/scheduled builds: enumerate every valid id to prebuild all pages.
    generatePaths: async () => {
        try {
            const res = await fetch('https://dummyjson.com/products?limit=1200')
            const json = await res.json()
            return json.products.map((product) => ({
                params: { id: String(product.id) },
                data: { product, title: product.title },
            }))
        } catch (err) {
            return []
        }
    },
}
