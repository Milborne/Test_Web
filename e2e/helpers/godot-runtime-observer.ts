import type { Frame, Page } from "@playwright/test";

declare global {
  interface Window {
    __game2webAudioContexts?: AudioContext[];
    __game2webKeyEvents?: Array<{ key: string; code: string }>;
  }
}

export async function installGodotRuntimeObservers(page: Page) {
  await page.addInitScript(() => {
    const contexts: AudioContext[] = [];
    const OriginalAudioContext = window.AudioContext;
    if (OriginalAudioContext) {
      window.AudioContext = new Proxy(OriginalAudioContext, {
        construct(target, argumentsList, newTarget) {
          const context = Reflect.construct(target, argumentsList, newTarget) as AudioContext;
          contexts.push(context);
          return context;
        }
      });
    }
    Object.defineProperty(window, "__game2webAudioContexts", { value: contexts });
    const keyEvents: Array<{ key: string; code: string }> = [];
    Object.defineProperty(window, "__game2webKeyEvents", { value: keyEvents });
    window.addEventListener("keydown", (event) => {
      keyEvents.push({ key: event.key, code: event.code });
    }, true);
  });
}

export async function godotAudioStates(frame: Frame) {
  return frame.evaluate(() => (window.__game2webAudioContexts ?? []).map((context) => context.state));
}

export async function godotKeyEvents(frame: Frame) {
  return frame.evaluate(() => window.__game2webKeyEvents ?? []);
}
