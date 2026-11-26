const SVG = "http://www.w3.org/2000/svg";

function svg(parent, name, attributes) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent.append(node);
  return node;
}

export function bindPhysicsDebug(hooks, building) {
  const overlays = new Map();
  const stages = [...hooks.root.querySelectorAll("[data-stage]")];

  function createOverlay(stage, geo) {
    const parent = stage.querySelector("[data-flip-layer]") ?? stage;
    const layer = svg(parent, "svg", {
      "data-physics-debug": "", "aria-hidden": "true", focusable: "false",
      style: "position:absolute;inset:0;width:100%;height:100%;z-index:20;pointer-events:none",
    });
    const parts = [];
    for (const [floor, room] of building.rooms) {
      if (geo.floors?.[floor] !== undefined || geo.ceilings?.[floor] !== undefined) {
        for (const [name, body] of Object.entries(room.props)) {
          const copy = building.copyBlocks.indexOf(body);
          if (copy !== -1 && !stage.querySelector(`[data-physics-body="copy:${copy}"]`)) continue;
          addPart(room, name, body);
        }
      }
      const lamp = stage.querySelector(`[data-physics-lamp="${floor}"]`);
      if (lamp && room.lamp) addPart(room, "lamp", room.lamp, lamp);
    }

    function addPart(room, name, body, lamp) {
      const { radius, points } = body.shape;
      const outline = radius
        ? svg(layer, "circle", { r: radius })
        : svg(layer, "polygon", { points: points.map(({ x, y }) => `${x},${y}`).join(" ") });
      outline.setAttribute("fill", "none");
      outline.setAttribute("stroke-width", "2");
      outline.setAttribute("vector-effect", "non-scaling-stroke");
      const label = svg(layer, "text", {
        "data-building-upright": "", "font-family": "monospace", "font-size": "11", fill: "white",
        stroke: "#161616", "stroke-width": "3", "paint-order": "stroke", style: "transform-box:fill-box;transform-origin:center",
      });
      parts.push({ room, name, body, outline, label, lamp });
    }
    return { layer, parts };
  }

  return {
    render(alpha) {
      for (const stage of stages) {
        const geo = window.LandingArt?.geometry?.(stage.dataset.stage);
        if (!geo?.w || !geo.h || !geo.floors) continue;
        if (!overlays.has(stage)) overlays.set(stage, createOverlay(stage, geo));
        const { layer, parts } = overlays.get(stage);
        layer.setAttribute("viewBox", `0 0 ${geo.w} ${geo.h}`);
        const sx = geo.w / building.width;
        for (const { room, name, body, outline, label, lamp } of parts) {
          let px, py, coords;
          if (lamp) {
            const ax = Number(lamp.dataset.ax), ay = Number(lamp.dataset.ay), len = Number(lamp.dataset.len);
            if (!Number.isFinite(ax + ay + len)) continue;
            // Read the displayed angle, including the fallen pose after a flip.
            const angle = parseFloat(lamp.style.getPropertyValue("--lamp-angle")) || 0;
            px = ax - len * Math.sin(angle);
            py = ay + len * Math.cos(angle);
            outline.setAttribute("transform", `translate(${px} ${py})`);
            coords = `${px.toFixed(1)}, ${py.toFixed(1)} px`;
          } else {
            const { x, y, angle } = body.pose(alpha);
            const top = geo.ceilings?.[room.id] ?? 0;
            const bottom = geo.floors[room.id] ?? geo.h;
            const sy = (bottom - top) / (room.bottom - room.top);
            px = x * sx;
            py = top + (y - room.top) * sy;
            outline.setAttribute("transform", `translate(${px} ${py}) scale(${sx} ${sy}) rotate(${angle * 180 / Math.PI})`);
            coords = `${x.toFixed(1)}, ${y.toFixed(1)}`;
          }
          outline.setAttribute("stroke", body.sleeping ? "#f9357a" : "#00c3aa");
          const alignRight = px > geo.w / 2;
          label.setAttribute("x", px + (alignRight ? -6 : 6));
          label.setAttribute("y", py - 6);
          label.setAttribute("text-anchor", alignRight ? "end" : "start");
          label.textContent = `${room.id}:${name} ${coords}`;
        }
      }
    },
    destroy() {
      for (const { layer } of overlays.values()) layer.remove();
      overlays.clear();
    },
  };
}
