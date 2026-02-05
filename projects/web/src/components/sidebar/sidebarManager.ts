import { action, computed, makeObservable, observable, runInAction } from "mobx"

const closeSidebarKey = "_code_close_sidebar"
const closeSidebarSmallScreenKey = "_code_close_sidebar_small"

class CodeSidebarManager {
    @observable private manuallyOpened = true
    @observable isSmallScreen = false
    private mediaQueryListener: MediaQueryList | null = null

    constructor() {
        makeObservable(this)
        this.setupMediaQueryListener()
        this.initializeSidebarState()
    }

    private setupMediaQueryListener() {
        if (typeof window !== "undefined") {
            this.mediaQueryListener = window.matchMedia("(max-width: 900px)")
            this.isSmallScreen = this.mediaQueryListener.matches
            this.mediaQueryListener.addEventListener("change", this.handleMediaQueryChange)
        }
    }

    private initializeSidebarState() {
        if (typeof window === "undefined" || typeof localStorage === "undefined") {
            this.manuallyOpened = false
            return
        }

        if (this.isSmallScreen) {
            const smallScreenPreference = localStorage.getItem(closeSidebarSmallScreenKey)
            if (smallScreenPreference === null) {
                this.manuallyOpened = false
            } else {
                this.manuallyOpened = !(smallScreenPreference === "true")
            }
        } else {
            this.manuallyOpened = !(localStorage.getItem(closeSidebarKey) === "true")
        }
    }

    @computed get showSidebar() {
        return this.manuallyOpened
    }

    @computed get isDrawerMode() {
        return this.isSmallScreen && this.manuallyOpened
    }

    @action.bound toggleSidebar() {
        this.manuallyOpened = !this.manuallyOpened

        if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
            if (this.isSmallScreen) {
                if (this.manuallyOpened === false) {
                    localStorage.setItem(closeSidebarSmallScreenKey, "true")
                } else {
                    localStorage.removeItem(closeSidebarSmallScreenKey)
                }
            } else {
                if (this.manuallyOpened === false) {
                    localStorage.setItem(closeSidebarKey, "true")
                } else {
                    localStorage.removeItem(closeSidebarKey)
                }
            }
        }
    }

    dispose() {
        if (this.mediaQueryListener) {
            this.mediaQueryListener.removeEventListener("change", this.handleMediaQueryChange)
        }
    }

    private handleMediaQueryChange = (e: MediaQueryListEvent) => {
        runInAction(() => {
            const wasSmallScreen = this.isSmallScreen
            this.isSmallScreen = e.matches

            if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
                if (!wasSmallScreen && this.isSmallScreen) {
                    this.manuallyOpened = false
                    localStorage.removeItem(closeSidebarSmallScreenKey)
                } else if (wasSmallScreen && !this.isSmallScreen) {
                    this.manuallyOpened = !(localStorage.getItem(closeSidebarKey) === "true")
                }
            }
        })
    }
}

export const codeSidebarManager = new CodeSidebarManager()
