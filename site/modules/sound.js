export function bindSoundToggle(button, createAudio, { status, signal, changed } = {}) {
  if (!button || !createAudio) return undefined;
  let audio, enabling = false;
  const label = button.querySelector("[data-sound-label]");

  function reflect() {
    const enabled = audio?.muted === false;
    button.dataset.pressed = String(enabled);
    button.removeAttribute("aria-pressed");
    button.setAttribute("aria-busy", String(enabling));
    if (label) label.textContent = enabled ? "소리 끄기" : "소리 켜기";
  }

  async function toggle() {
    if (enabling || signal?.aborted) return;
    if (status) status.textContent = "";
    if (audio?.muted === false) {
      audio.mute();
      reflect();
      changed?.();
      return;
    }
    enabling = true;
    reflect();
    try {
      // Both creation and enable start in this click, before the first await.
      audio ??= createAudio();
      if (!await audio?.enable() && !signal?.aborted && status) status.textContent = "소리를 켤 수 없습니다.";
    } catch {
      if (!signal?.aborted && status) status.textContent = "소리를 켤 수 없습니다.";
    } finally {
      enabling = false;
      if (signal?.aborted) audio?.mute();
      else {
        reflect();
        changed?.();
      }
    }
  }

  button.hidden = false;
  reflect();
  button.addEventListener("click", toggle, { signal });
  signal?.addEventListener("abort", () => audio?.mute(), { once: true });
  return { get audio() { return audio; } };
}
