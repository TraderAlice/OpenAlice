/**
 * Renderer preload bridge (MVP — intentionally empty).
 *
 * The renderer talks to the backend via plain HTTP/WS over the localhost
 * port the guardian chose, so it doesn't need any special IPC surface to
 * function. Future iterations may add native-shell calls (system file
 * dialogs, menu actions, tray badge updates) via
 * `contextBridge.exposeInMainWorld(...)` here.
 */
export {}
