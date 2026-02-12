// Deploy app instrumentation - intentionally minimal
// The root matrx-ship project has its own instrumentation.ts with DB migrations;
// this file prevents Turbopack from picking up the root project's version.
export async function register() {
  // No-op for deploy app
}
