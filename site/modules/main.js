import { loadAdapters } from "@landing/adapters.js";
import { bindHooks } from "@landing/hooks.js";
import { mountScenes } from "@landing/scenes.js";

const lifecycle = new AbortController();

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) lifecycle.abort();
});

const adapters = await loadAdapters();
if (!lifecycle.signal.aborted) {
  mountScenes(bindHooks(document), adapters, lifecycle.signal);
}
