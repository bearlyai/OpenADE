/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

import type { OpenADEAPI } from "../../electron/src/preload-api"

declare global {
    interface Window {
        openadeAPI?: OpenADEAPI
    }
}
