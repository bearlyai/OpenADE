export const REMOTE_THREAD_BOTTOM_THRESHOLD_PX = 80

export function shouldFollowRemoteThread(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
    return scrollHeight - scrollTop - clientHeight < REMOTE_THREAD_BOTTOM_THRESHOLD_PX
}
