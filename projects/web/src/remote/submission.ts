export interface RemoteSubmissionLock {
    current: boolean
}

export interface RemoteSubmissionStateSetters {
    setSubmitting(value: boolean): void
    setLoading(value: boolean): void
}

export function beginRemoteSubmission(lock: RemoteSubmissionLock, setters: RemoteSubmissionStateSetters): boolean {
    if (lock.current) return false
    lock.current = true
    setters.setSubmitting(true)
    setters.setLoading(true)
    return true
}

export function finishRemoteSubmission(lock: RemoteSubmissionLock, setters: RemoteSubmissionStateSetters): void {
    lock.current = false
    setters.setSubmitting(false)
    setters.setLoading(false)
}
