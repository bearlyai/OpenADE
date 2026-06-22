import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { HashRouter } from "react-router"
import { OpenADEApp } from "./App"
import "./index.css"

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <HashRouter>
            <OpenADEApp />
        </HashRouter>
    </StrictMode>
)
