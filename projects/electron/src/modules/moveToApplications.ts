import { app, dialog } from "electron"
import { isDev } from "../config"

export const load = () => {
    app.on("ready", () => {
        if (process.platform !== "darwin" || isDev || app.isInApplicationsFolder()) {
            return
        }
        const respId = dialog.showMessageBoxSync({
            type: "question",
            buttons: ["Move to Applications", "Quit"],
            defaultId: 0,
            cancelId: 1,
            title: "Move to Applications",
            message: "OpenADE needs to run from the applications directory. Should we move it?",
        })
        if (respId === 0) {
            try {
                app.moveToApplicationsFolder()
            } catch (err) {
                dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Okay"],
                    message: `There was problem moving to the Applications folder. Try quitting the application and moving it manually.`,
                })
            }
        } else {
            app.quit()
        }
    })
}
