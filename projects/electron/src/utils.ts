export const waitFor = async (cond: () => boolean, interval: number, timeout: number): Promise<boolean> => {
    if (cond()) {
        return Promise.resolve(true)
    }
    const start = Date.now()
    return new Promise((resolve, reject) => {
        const inter = setInterval(() => {
            if (cond()) {
                clearInterval(inter)
                resolve(true)
            }
            if (Date.now() - start > timeout) {
                clearInterval(inter)
                reject("timeout")
            }
        }, interval)
    })
}
