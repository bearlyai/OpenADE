const fs = require("fs")
const path = require("path")
const process = require("process")
const { notarize } = require("@electron/notarize")

module.exports = async function (params) {
    // Only notarize the app on Mac OS only.
    if (process.env.NONOTARY) {
        return
    }
    if (process.platform !== "darwin") {
        return
    }
    // Same appId in electron-builder.
    let appId = "com.openade.app"

    let appPath = path.join(params.appOutDir, `${params.packager.appInfo.productFilename}.app`)
    if (!fs.existsSync(appPath)) {
        throw new Error(`Cannot find application at: ${appPath}`)
    }

    console.log(`Notarizing ${appId} found at ${appPath}`)

    try {
        await notarize({
            appPath: appPath,
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
        })
    } catch (error) {
        console.error(error)
        process.exit(1)
    }

    console.log(`Done notarizing ${appId}`)
}
