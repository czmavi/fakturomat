import { options } from "preact";

declare global {
  interface Window {
    CaretSixControl?: {
      captureException(error: unknown): unknown;
      startSpan(name: string): { end(error?: unknown): unknown };
    };
  }
}

export const browserTelemetry = () =>
  (globalThis as unknown as Window).CaretSixControl;

// Preact's distributed runtime calls __e when rendering/lifecycle code throws.
// Its previous handler returns for handled errors and rethrows unhandled ones;
// leave those to the SDK's global listeners. Suspense thenables are not errors.
export function installPreactTelemetry() {
  const hooks = options as typeof options & {
    __e: (error: unknown, ...args: unknown[]) => unknown;
  };
  const previous = hooks.__e;
  hooks.__e = function (error, ...args) {
    const result = previous.call(this, error, ...args);
    if (
      !(error && typeof (error as PromiseLike<unknown>).then === "function")
    ) {
      browserTelemetry()?.captureException(error);
    }
    return result;
  };
}
