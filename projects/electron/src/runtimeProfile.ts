import { app } from "electron"
import path from "path"
import { isDev } from "./config"

const devAppName = "OpenADE Dev"

if (isDev) {
    app.setName(devAppName)
    app.setPath("userData", path.join(app.getPath("appData"), devAppName))
}
