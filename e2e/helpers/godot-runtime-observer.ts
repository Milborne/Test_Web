import type { Frame, Page } from "@playwright/test";

declare global {
  interface Window {
    __game2webAudioContexts?: AudioContext[];
    __game2webAudioDiagnostics?: Array<Record<string, string | number | boolean | null>>;
    __game2webKeyEvents?: Array<{ key: string; code: string }>;
    __game2webUnhandledRejections?: Array<{ name: string; message: string; stack: string }>;
  }
}

export async function installGodotRuntimeObservers(page: Page, options: { diagnoseAudioWorklets?: boolean } = {}) {
  await page.addInitScript((diagnoseAudioWorklets) => {
    const contexts: AudioContext[] = [];
    const audioDiagnostics: Array<Record<string, string | number | boolean | null>> = [];
    const workletOwners = new WeakMap<AudioWorklet, AudioContext>();
    const patchedWorkletPrototypes = new WeakSet<object>();
    const OriginalAudioContext = window.AudioContext;
    if (OriginalAudioContext) {
      window.AudioContext = new Proxy(OriginalAudioContext, {
        construct(target, argumentsList, newTarget) {
          const context = Reflect.construct(target, argumentsList, newTarget) as AudioContext;
          contexts.push(context);
          const recordContext = (event: string) => {
            audioDiagnostics.push({
              event,
              state: context.state,
              baseLatency: context.baseLatency,
              outputLatency: "outputLatency" in context ? Number(context.outputLatency) : null,
              audioWorkletAvailable: "audioWorklet" in context
            });
          };
          recordContext("created");
          if ("audioWorklet" in context) {
            const worklet = context.audioWorklet;
            workletOwners.set(worklet, context);
            const prototype = Object.getPrototypeOf(worklet) as { addModule?: AudioWorklet["addModule"] };
            if (diagnoseAudioWorklets && !patchedWorkletPrototypes.has(prototype) && typeof prototype.addModule === "function") {
              const originalAddModule = prototype.addModule;
              prototype.addModule = function (this: AudioWorklet, moduleURL, options) {
                const url = new URL(moduleURL, document.baseURI).href;
                audioDiagnostics.push({ event: "worklet-module-requested", url });
                const result = Reflect.apply(originalAddModule, this, [moduleURL, options]);
                const owner = workletOwners.get(this);
                void result.then(
                  () => audioDiagnostics.push({ event: "worklet-module-loaded", url, contextState: owner?.state ?? null }),
                  (error: unknown) => {
                    const workletError = error instanceof Error ? error : new Error(String(error));
                    audioDiagnostics.push({
                      event: "worklet-module-failed",
                      url,
                      name: workletError.name,
                      message: workletError.message,
                      stack: workletError.stack ?? "",
                      contextState: owner?.state ?? null
                    });
                  }
                );
                return result;
              };
              patchedWorkletPrototypes.add(prototype);
            }
          }
          context.addEventListener("statechange", () => recordContext("statechange"));
          return context;
        }
      });
    }
    Object.defineProperty(window, "__game2webAudioContexts", { value: contexts });
    Object.defineProperty(window, "__game2webAudioDiagnostics", { value: audioDiagnostics });
    const unhandledRejections: Array<{ name: string; message: string; stack: string }> = [];
    Object.defineProperty(window, "__game2webUnhandledRejections", { value: unhandledRejections });
    if (diagnoseAudioWorklets) {
      window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        unhandledRejections.push({ name: reason.name, message: reason.message, stack: reason.stack ?? "" });
      });
    }
    const keyEvents: Array<{ key: string; code: string }> = [];
    Object.defineProperty(window, "__game2webKeyEvents", { value: keyEvents });
    window.addEventListener("keydown", (event) => {
      keyEvents.push({ key: event.key, code: event.code });
    }, true);
  }, Boolean(options.diagnoseAudioWorklets));
}

export async function godotAudioStates(frame: Frame) {
  return frame.evaluate(() => (window.__game2webAudioContexts ?? []).map((context) => context.state));
}

export async function godotAudioDiagnostics(frame: Frame) {
  return frame.evaluate(() => ({
    browser: navigator.userAgent,
    crossOriginIsolated: window.crossOriginIsolated,
    audioWorkletAvailable: (window.__game2webAudioContexts ?? []).some((context) => "audioWorklet" in context),
    contexts: (window.__game2webAudioContexts ?? []).map((context) => ({
      state: context.state,
      baseLatency: context.baseLatency,
      outputLatency: "outputLatency" in context ? Number(context.outputLatency) : null,
      audioWorkletAvailable: "audioWorklet" in context
    })),
    events: window.__game2webAudioDiagnostics ?? []
  }));
}

export async function godotUnhandledRejections(frame: Frame) {
  return frame.evaluate(() => window.__game2webUnhandledRejections ?? []);
}

export async function godotKeyEvents(frame: Frame) {
  return frame.evaluate(() => window.__game2webKeyEvents ?? []);
}
