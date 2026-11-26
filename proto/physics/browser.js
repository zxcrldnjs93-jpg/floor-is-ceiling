const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function fixedLoop(world, target, render, { dt=1/120,maxSteps=8,onReduced }={}) {
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new RangeError('Invalid fixed loop parameters');
  }
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = typeof IntersectionObserver === 'undefined', running = true;
  let frame = 0, previous, carry = 0;
  function schedule() {
    const active = running && visible && !preference.matches && !document.hidden;
    if (active && !frame) frame = requestAnimationFrame(tick);
    if (!active) {
      cancelAnimationFrame(frame);
      frame = carry = 0;
      previous = undefined;
    }
  }
  function tick(time) {
    frame = 0;
    carry += Math.min((time-(previous ?? time))/1000,dt*maxSteps);
    previous = time;
    let steps = 0;
    while (carry >= dt && steps < maxSteps) {
      world.step(dt);
      carry -= dt;
      steps++;
    }
    render(clamp(carry/dt,0,1));
    schedule();
  }
  function motion() {
    onReduced?.(preference.matches);
    render(1);
    schedule();
  }
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  });
  observer?.observe(target);
  document.addEventListener('visibilitychange',schedule);
  preference.addEventListener('change',motion);
  motion();
  return {
    pause() { running = false; schedule(); },
    resume() { running = true; schedule(); },
    destroy() {
      running = false;
      schedule();
      observer?.disconnect();
      document.removeEventListener('visibilitychange',schedule);
      preference.removeEventListener('change',motion);
    }
  };
}

export function bindDOM(body, element) {
  const old = element.style.transform;
  const oldOrigin = element.style.transformOrigin;
  element.style.transformOrigin = '0 0';
  let last;
  return {
    render(alpha) {
      const {x,y,angle} = body.pose(alpha);
      const transform = `translate(${x}px,${y}px) rotate(${angle}rad) translate(-50%,-50%)`;
      if (last !== transform) element.style.transform = last = transform;
    },
    destroy() {
      element.style.transform = old;
      element.style.transformOrigin = oldOrigin;
    }
  };
}

export function contain(world, element, onResize) {
  let walls = [], oldWidth, oldHeight;
  const measure = () => {
    const width = element.clientWidth, height = element.clientHeight;
    if (!width || !height || (width === oldWidth && height === oldHeight)) return;
    for (const wall of walls) world.remove(wall);
    const t = 96;
    walls = [
      world.add({fixed:true,width:t,height:height+2*t,x:-t/2,y:height/2}),
      world.add({fixed:true,width:t,height:height+2*t,x:width+t/2,y:height/2}),
      world.add({fixed:true,width:width,height:t,x:width/2,y:-t/2}),
      world.add({fixed:true,width:width,height:t,x:width/2,y:height+t/2})
    ];
    for (const b of world.bodies) if (b.inv) {
      const x = clamp(b.x,b.x-b.left,width+b.x-b.right);
      const y = clamp(b.y,b.y-b.top,height+b.y-b.bottom);
      const nextX = b.right-b.left > width ? width/2 : x;
      const nextY = b.bottom-b.top > height ? height/2 : y;
      if (nextX !== b.x || nextY !== b.y) world.move(b,nextX,nextY);
    }
    oldWidth = width;
    oldHeight = height;
    onResize?.(width,height);
  };
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  measure();
  return () => {
    observer.disconnect();
    for (const wall of walls) world.remove(wall);
  };
}

export function dragPointer(world, element, {pick}={}) {
  let pointer, joint, last, vx, vy;
  function point(e) {
    const rect = element.getBoundingClientRect();
    return {x:e.clientX-rect.left-element.clientLeft,y:e.clientY-rect.top-element.clientTop};
  }
  function down(e) {
    if (pointer !== undefined || e.button !== 0) return;
    const p = point(e);
    const body = pick
      ? pick(e,p)
      : world.bodies.findLast(b => b.inv && b.contains(p.x,p.y));
    if (!body?.inv || !world.bodies.includes(body)) return;
    pointer = e.pointerId;
    element.setPointerCapture(pointer);
    last = e.timeStamp;
    vx = vy = 0;
    joint = world.link(body,null,{
      anchorA:body.local(p.x,p.y),anchorB:p,length:0,frequency:8,maxForce:4200/body.inv
    });
  }
  function move(e) {
    if (e.pointerId !== pointer) return;
    const p = point(e), elapsed = (e.timeStamp-last)/1000;
    if (elapsed > 0) {
      vx = clamp((p.x-joint.anchorB.x)/Math.max(1/120,elapsed),-1400,1400);
      vy = clamp((p.y-joint.anchorB.y)/Math.max(1/120,elapsed),-1400,1400);
    }
    joint.anchorB = p;
    last = e.timeStamp;
    world.wake(joint.a);
  }
  function end(e) {
    if (e.pointerId !== pointer) return;
    pointer = undefined;
    const body = joint.a;
    if (e.type === 'pointerup' && e.timeStamp-last < 110 && (vx || vy)) {
      world.kick(body,0.45*(vx-body.vx),0.45*(vy-body.vy));
    }
    world.unlink(joint);
    joint = undefined;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
  }
  const events = {pointerdown:down,pointermove:move,pointerup:end,pointercancel:end,lostpointercapture:end};
  for (const [name,handler] of Object.entries(events)) element.addEventListener(name,handler);
  return () => {
    if (pointer !== undefined) end({pointerId:pointer});
    for (const [name,handler] of Object.entries(events)) element.removeEventListener(name,handler);
  };
}

export function orientationToGravity({beta,gamma}, {angle=0,strength=1000}={}) {
  if (![beta,gamma,angle,strength].every(Number.isFinite)) return null;
  const radians = Math.PI/180;
  const right = Math.sin(gamma*radians)*Math.cos(beta*radians);
  const down = Math.sin(beta*radians);
  const cos = Math.cos(angle*radians), sin = Math.sin(angle*radians);
  return { x:strength*(right*cos+down*sin), y:strength*(-right*sin+down*cos) };
}

export async function requestOrientation({onFailure}={}) {
  const source = globalThis.window;
  const Orientation = source?.DeviceOrientationEvent;
  let status = 'enabled';
  if (!source?.isSecureContext || !Orientation) status = 'unavailable';
  else {
    try {
      if (typeof Orientation.requestPermission === 'function' &&
          await Orientation.requestPermission() !== 'granted') status = 'denied';
    } catch {
      status = 'denied';
    }
  }
  if (status !== 'enabled') onFailure?.(status);
  return status;
}

export function tiltGravity(world, { strength=1000, threshold=18, sampleTimeout=1800,
  onFailure, onGravity=vec => world.gravity(vec.x,vec.y) }={}) {
  let listening = false, pending, generation = 0, timer, received;
  let base, filtered, applied;
  function sample(e) {
    const angle = globalThis.screen?.orientation?.angle ?? window.orientation ?? 0;
    const g = orientationToGravity(e,{angle,strength});
    if (!g) return;
    clearTimeout(timer);
    received = true;
    filtered.x += 0.22*(g.x-filtered.x);
    filtered.y += 0.22*(g.y-filtered.y);
    if (Math.hypot(filtered.x-applied.x,filtered.y-applied.y) >= threshold) {
      applied = {...filtered};
      onGravity(applied);
    }
  }
  function start() {
    if (listening) return Promise.resolve('enabled');
    if (pending) return pending;
    const attempt = ++generation;
    pending = requestOrientation().then(status => {
      if (attempt !== generation) return 'cancelled';
      pending = undefined;
      if (status !== 'enabled') {
        onFailure?.(status);
        return status;
      }
      base = {x:world.gx,y:world.gy};
      applied = base;
      filtered = {...base};
      received = false;
      window.addEventListener('deviceorientation',sample);
      listening = true;
      if (sampleTimeout > 0) timer = setTimeout(() => {
        stop();
        onFailure?.('no-sample');
      },sampleTimeout);
      return status;
    });
    return pending;
  }
  function stop() {
    generation++;
    pending = undefined;
    clearTimeout(timer);
    if (!listening) return;
    window.removeEventListener('deviceorientation',sample);
    listening = false;
    if (received) onGravity(base);
  }
  return {start,stop};
}
