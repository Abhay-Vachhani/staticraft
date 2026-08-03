export default {
    revalidate: 300, // 300s = 5 min
    data: async () => {
        try {
            const res = await fetch('https://dummyjson.com/products?limit=1200')
            const json = await res.json()
            return { products: json.products || [] }
        } catch (err) {
            return { products: [] }
        }
    },
}
