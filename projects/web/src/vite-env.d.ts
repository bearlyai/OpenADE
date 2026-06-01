/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

import type { OpenADEAPI } from "../../electron/src/preload-api"

// Make this file a module so declare global works
export {}

declare global {
    interface Window {
        openadeAPI?: OpenADEAPI
    }
}
