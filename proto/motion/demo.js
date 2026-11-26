(function () {
  "use strict";

  const { createMotion, easing, tween, splitText, drawPath, morphPath, counter } = window.LandingMotion;
  const line = document.getElementById("line");
  const signal = document.getElementById("signal");
  const caption = document.getElementById("line-caption");
  const switchDriver = document.getElementById("switch-driver");
  const driverStatus = document.getElementById("driver");
  const status = document.getElementById("signal-status");
  const chip = document.getElementById("chip");

  const glyphTracks = splitText(document.getElementById("line-title")).map((element, index) => {
    const start = index * 0.025;
    return { element, from: { y: 12, opacity: 0.25 }, to: { y: 0, opacity: 1 },
      start, end: start + 0.34, ease: easing.easeOut };
  });

  const renderLine = drawPath(document.getElementById("draw"));
  const renderShape = morphPath(document.getElementById("morph"), "M 192 88 L 250 30 L 308 88 L 250 146 Z");
  const lineProgress = tween(0, 1, { start: 0.15, end: 0.56 });
  const shapeProgress = tween(0, 1, { start: 0.55, end: 0.95, ease: easing.easeInOut });
  const renderCounter = counter(document.getElementById("counter"), { to: 100, label: "장면 완료 시 100퍼센트" });

  const marker = document.createElement("span");
  marker.textContent = "신호 도착";
  marker.setAttribute("aria-hidden", "true");

  let controller;
  function mount(driver) {
    controller?.destroy();
    controller = createMotion({ driver });
    controller.addScene(line, {
      tracks: [...glyphTracks, { element: caption, from: { y: 10, opacity: 0.4 }, to: { y: 0, opacity: 1 },
        start: 0.25, end: 0.72, ease: easing.easeInOut }],
      onProgress(progress) {
        renderLine(lineProgress(progress));
        renderShape(shapeProgress(progress));
      },
    });

    controller.addScene(signal, {
      onProgress(progress, { reduced }) {
        renderCounter(progress);
        if (reduced) status.textContent = "장면 진행률 60%에서 신호를 보냅니다.";
      },
      events: [{
        at: 0.6,
        enter() {
          chip.append(marker);
          status.textContent = "진행률 60% 통과";
        },
        leave({ reduced }) {
          marker.remove();
          if (!reduced) status.textContent = "장면 진행률 60%에서 신호";
        },
      }],
    });

    const native = controller.driver === "css";
    driverStatus.textContent = native ? "CSS 스크롤 타임라인" : "JS 스크롤 타임라인";
    switchDriver.textContent = native ? "JS 대체 사용" : "자동 선택 사용";
  }

  mount("auto");
  switchDriver.hidden = controller.driver !== "css";
  switchDriver.addEventListener("click", () => mount(controller.driver === "css" ? "js" : "auto"));
})();
