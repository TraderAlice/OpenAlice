// napi-rs build hook.
//
// Sets up the platform-specific link args required for Node-API loadable
// addons (rdynamic on Unix, weak Node symbols on macOS/Windows). Without
// this the resulting cdylib will not be loadable through Node's
// `process.dlopen` path.

fn main() {
    napi_build::setup();
}
