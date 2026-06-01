import path from "node:path"

export default {
    test: {
        environment: "node",
        watch: false,
        include: ["src/**/*.test.ts"],
    },
    resolve: {
        alias: {
            ws: path.resolve(__dirname, "../electron/node_modules/ws/wrapper.mjs"),
            yjs: path.resolve(__dirname, "../electron/node_modules/yjs/src/index.js"),
        },
    },
}
