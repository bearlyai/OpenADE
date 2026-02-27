import { Paperclip } from "lucide-react"

export function ImageDropOverlay() {
    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
            <div className="rounded-2xl border-2 border-dashed border-primary bg-base-100/90 px-12 py-10 text-center">
                <Paperclip className="mx-auto mb-3 h-10 w-10 text-primary" />
                <p className="text-lg font-medium text-base-content">Drop images here</p>
                <p className="text-sm text-muted mt-1">PNG, JPG, GIF, WebP</p>
            </div>
        </div>
    )
}
