export default {
    revalidate: 600, // 600s = 10 min
    data: async () => {
        try {
            const res = await fetch('https://dummyjson.com/products?limit=6')
            const json = await res.json()
            return { products: json.products || [] }
        } catch (err) {
            return { products: [] }
        }
    },
}
