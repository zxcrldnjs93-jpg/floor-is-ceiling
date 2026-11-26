// Positions are CSS pixels, time is seconds, angles are radians.
const EPS = 1e-8;
const cross = (ax, ay, bx, by) => ax * by - ay * bx;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const defaultMaterial = { friction:0.5, restitution:0.12, damping:0 };
export const MATERIALS = Object.freeze({
  hardFloor: Object.freeze({ friction:0.60, restitution:0.40, damping:0.02 }),
  mat: Object.freeze({ friction:0.86, restitution:0.06, damping:0.82 }),
  slipper: Object.freeze({ friction:0.64, restitution:0.07, damping:0.75 }),
  chairCover: Object.freeze({ friction:0.19, restitution:0.08, damping:0.72 })
});

function coefficients(material = defaultMaterial, overrides = {}) {
  const preset = typeof material === 'string' && Object.hasOwn(MATERIALS,material)
    ? MATERIALS[material] : material;
  if (!preset || typeof preset !== 'object') throw new RangeError('Invalid material');
  const {
    friction = preset.friction ?? defaultMaterial.friction,
    restitution = preset.restitution ?? defaultMaterial.restitution,
    damping = preset.damping ?? defaultMaterial.damping
  } = overrides;
  if (!Number.isFinite(friction) || friction < 0 ||
      !(restitution >= 0 && restitution <= 1) || !(damping >= 0 && damping <= 1) ||
      !Number.isFinite(restitution) || !Number.isFinite(damping)) throw new RangeError('Invalid material coefficients');
  return { friction, restitution, damping };
}

function geometry({ radius, vertices, width, height }) {
  if (radius !== undefined) {
    if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid radius');
    return { radius, inertia: radius * radius / 2 };
  }
  if (!vertices && width > 0 && height > 0) {
    const x = width / 2, y = height / 2;
    vertices = [{x:-x,y:-y}, {x,y:-y}, {x,y}, {x:-x,y}];
  }
  if (!vertices || vertices.length < 3) throw new RangeError('Expected a convex polygon');
  let area = 0, cx = 0, cy = 0, inertia = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const k = cross(a.x, a.y, b.x, b.y);
    area += k;
    cx += k * (a.x + b.x);
    cy += k * (a.y + b.y);
    inertia += k * (a.x*a.x + a.x*b.x + b.x*b.x + a.y*a.y + a.y*b.y + b.y*b.y);
  }
  if (!Number.isFinite(area) || Math.abs(area) < EPS) throw new RangeError('Invalid polygon area');
  cx /= 3 * area;
  cy /= 3 * area;
  const points = vertices.map(({x, y}) => ({ x:x-cx, y:y-cy }));
  if (area < 0) points.reverse();
  // A supporting edge must have every other vertex on its interior side.
  const normals = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (length < EPS || points.some(p => cross(dx, dy, p.x-a.x, p.y-a.y) < -EPS)) {
      throw new RangeError('Vertices must trace a convex perimeter without repeated neighbors');
    }
    return { x:dy/length, y:-dx/length };
  });
  return { points, normals, inertia: inertia / (6 * area) - cx*cx - cy*cy };
}

class Body {
  constructor(id, options) {
    const { x=0, y=0, angle=0, vx=0, vy=0, spin=0, mass=1, material, fixed=false } = options;
    if (![x,y,angle,vx,vy,spin].every(Number.isFinite)) throw new RangeError('Invalid body parameters');
    this.shape = geometry(options);
    if (!fixed && (!Number.isFinite(mass) || mass <= 0)) throw new RangeError('Invalid mass');
    Object.assign(this, { id, x, y, angle, vx, vy, spin }, coefficients(material, options));
    if (options.topSpring) {
      const {stiffness,damping} = options.topSpring;
      if (!fixed || ![stiffness,damping].every(Number.isFinite) || stiffness <= 0 || damping < 0) {
        throw new RangeError('A compliant top requires a fixed body, positive stiffness and nonnegative damping');
      }
      this.topSpring = {stiffness,damping};
    }
    this.px = x;
    this.py = y;
    this.pa = angle;
    this.inv = fixed ? 0 : 1 / mass;
    this.invI = fixed ? 0 : this.inv / Math.max(EPS, this.shape.inertia);
    if (fixed) this.vx = this.vy = this.spin = 0;
    this.hull = this.shape.points?.map(() => ({ x:0, y:0, nx:0, ny:0 }));
    this.sleeping = false;
    this.idle = 0;
    this.update();
  }

  update() {
    const { x, y, angle, hull, shape } = this;
    if (!hull) {
      this.left = x - shape.radius;
      this.right = x + shape.radius;
      this.top = y - shape.radius;
      this.bottom = y + shape.radius;
      return;
    }
    const c = Math.cos(angle), s = Math.sin(angle);
    this.left = this.top = Infinity;
    this.right = this.bottom = -Infinity;
    for (let i = 0; i < hull.length; i++) {
      const p = shape.points[i], n = shape.normals[i], v = hull[i];
      v.x = x + c*p.x - s*p.y;
      v.y = y + s*p.x + c*p.y;
      v.nx = c*n.x - s*n.y;
      v.ny = s*n.x + c*n.y;
      this.left = Math.min(this.left, v.x);
      this.right = Math.max(this.right, v.x);
      this.top = Math.min(this.top, v.y);
      this.bottom = Math.max(this.bottom, v.y);
    }
  }

  local(x, y) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return { x:c*(x-this.x)+s*(y-this.y), y:-s*(x-this.x)+c*(y-this.y) };
  }

  contains(x, y) {
    return this.hull
      ? this.hull.every(v => (x-v.x)*v.nx + (y-v.y)*v.ny <= 0)
      : (x-this.x)**2 + (y-this.y)**2 <= this.shape.radius**2;
  }

  pose(alpha = 1) {
    return {
      x: this.px + (this.x-this.px)*alpha,
      y: this.py + (this.y-this.py)*alpha,
      angle: this.pa + (this.angle-this.pa)*alpha
    };
  }
}

function faceAgainst(hull, other) {
  let separation = -Infinity, index = 0;
  for (let i = 0; i < hull.length; i++) {
    const n = hull[i];
    let nearest = Infinity;
    for (const p of other) nearest = Math.min(nearest, (p.x-n.x)*n.nx + (p.y-n.y)*n.ny);
    if (nearest > separation) {
      separation = nearest;
      index = i;
    }
  }
  return { separation, index };
}

function polygons(a, b) {
  const first = faceAgainst(a.hull, b.hull);
  if (first.separation > 0) return;
  const second = faceAgainst(b.hull, a.hull);
  if (second.separation > 0) return;
  const flip = second.separation > first.separation + 0.05;
  const ref = flip ? b.hull : a.hull, inc = flip ? a.hull : b.hull;
  const i = (flip ? second : first).index;
  const u = ref[i], v = ref[(i + 1) % ref.length];
  const { nx, ny } = u;
  let k = 0;
  for (let j = 1; j < inc.length; j++) {
    if (inc[j].nx*nx + inc[j].ny*ny < inc[k].nx*nx + inc[k].ny*ny) k = j;
  }
  const p = inc[k], q = inc[(k + 1) % inc.length];
  const tx = -ny, ty = nx, length = (v.x-u.x)*tx + (v.y-u.y)*ty;
  const start = (p.x-u.x)*tx + (p.y-u.y)*ty;
  const dx = q.x-p.x, dy = q.y-p.y, span = dx*tx + dy*ty;
  let lo = 0, hi = 1;
  if (Math.abs(span) < EPS) {
    if (start < 0 || start > length) return;
  } else {
    const t0 = -start/span, t1 = (length-start)/span;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return;
  }
  const points = [];
  for (const t of hi-lo > EPS ? [lo, hi] : [lo]) {
    const x = p.x+t*dx, y = p.y+t*dy, depth = (u.x-x)*nx + (u.y-y)*ny;
    if (depth >= -EPS) points.push({ x:x+nx*depth/2, y:y+ny*depth/2, depth });
  }
  if (points.length) return { nx:flip ? -nx : nx, ny:flip ? -ny : ny, points };
}

function circlePolygon(circle, poly) {
  const { x, y, shape:{radius} } = circle;
  const hull = poly.hull;
  let face = hull[0], separation = -Infinity;
  for (const p of hull) {
    const d = (x-p.x)*p.nx + (y-p.y)*p.ny;
    if (d > radius) return;
    if (d > separation) {
      face = p;
      separation = d;
    }
  }
  let nx = -face.nx, ny = -face.ny, depth = radius-separation;
  if (separation > 0) {
    let distance2 = Infinity;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i], b = hull[(i + 1) % hull.length];
      const dx = b.x-a.x, dy = b.y-a.y;
      const t = clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy), 0, 1);
      const qx = a.x+t*dx-x, qy = a.y+t*dy-y;
      const d2 = qx*qx+qy*qy;
      if (d2 < distance2) {
        distance2 = d2;
        nx = qx;
        ny = qy;
      }
    }
    if (distance2 > radius*radius) return;
    const distance = Math.sqrt(distance2);
    nx = distance > EPS ? nx/distance : -face.nx;
    ny = distance > EPS ? ny/distance : -face.ny;
    depth = radius-distance;
  }
  const offset = radius-depth/2;
  return { nx, ny, points:[{ x:x+nx*offset, y:y+ny*offset, depth }] };
}

function collide(a, b) {
  if (a.hull && b.hull) return polygons(a, b);
  if (!a.hull && b.hull) return circlePolygon(a, b);
  if (a.hull) {
    const m = circlePolygon(b, a);
    if (m) { m.nx *= -1; m.ny *= -1; }
    return m;
  }
  const dx = b.x-a.x, dy = b.y-a.y, sum = a.shape.radius+b.shape.radius;
  const d2 = dx*dx+dy*dy;
  if (d2 > sum*sum) return;
  const d = Math.sqrt(d2), nx = d ? dx/d : 1, ny = d ? dy/d : 0;
  const depth = sum-d, offset = a.shape.radius-depth/2;
  return { nx, ny, points:[{ x:a.x+nx*offset, y:a.y+ny*offset, depth }] };
}

function root(b) {
  while (b.parent !== b) {
    b.parent = b.parent.parent;
    b = b.parent;
  }
  return b;
}

function join(a, b) {
  if (!a?.inv || !b?.inv) return;
  a = root(a);
  b = root(b);
  if (a === b) return;
  if (a.rank < b.rank) [a,b] = [b,a];
  b.parent = a;
  if (a.rank === b.rank) a.rank++;
}

function lever(body, x, y) {
  return body ? { x:x-body.x, y:y-body.y } : {x:0,y:0};
}

function along(c, x, y) {
  const { a, b, ra, rb } = c;
  return ((b?.vx ?? 0) - a.vx - (b?.spin ?? 0)*rb.y + a.spin*ra.y)*x
       + ((b?.vy ?? 0) - a.vy + (b?.spin ?? 0)*rb.x - a.spin*ra.x)*y;
}

function inverseMass(c, x, y) {
  const {a,b,ra,rb} = c;
  return a.inv + (b?.inv ?? 0) + cross(ra.x,ra.y,x,y)**2*a.invI
    + cross(rb.x,rb.y,x,y)**2*(b?.invI ?? 0);
}

function impulse(c, x, y) {
  const {a,b,ra,rb} = c;
  if (a.inv) {
    a.vx -= x*a.inv;
    a.vy -= y*a.inv;
    a.spin -= cross(ra.x,ra.y,x,y)*a.invI;
  }
  if (b?.inv) {
    b.vx += x*b.inv;
    b.vy += y*b.inv;
    b.spin += cross(rb.x,rb.y,x,y)*b.invI;
  }
}

function contactPoints(m, old, dt, measureImpact) {
  const {a,b,nx,ny} = m;
  const friction = Math.sqrt(a.friction*b.friction);
  const bounce = Math.max(a.restitution, b.restitution) * (1-Math.max(a.damping,b.damping));
  const spring = ny < -0.5 ? a.topSpring : ny > 0.5 ? b.topSpring : undefined;
  const softness = spring ? 1/(dt*(spring.damping+dt*spring.stiffness)) : 0;
  const matched = new Set();
  const previous = old && old.nx*nx+old.ny*ny > 0.95 ? old.points : [];
  for (const p of m.points) {
    Object.assign(p, { a,b,nx,ny,friction,ra:lever(a,p.x,p.y),rb:lever(b,p.x,p.y),normal:0,tangent:0 });
    p.softness = softness;
    p.nMass = 1 / (inverseMass(p,nx,ny)+softness);
    p.tMass = 1 / inverseMass(p,-ny,nx);
    const vn = along(p,nx,ny);
    if (measureImpact) {
      p.closingSpeed = Math.max(0,-vn);
      p.slipSpeed = Math.abs(along(p,-ny,nx));
    }
    // A compliant upper surface transfers its reaction through an implicit spring and damper.
    p.bias = spring ? p.depth*dt*spring.stiffness*softness
      : Math.max(Math.min(160, 0.2*Math.max(0,p.depth-0.35)/dt), vn < -55 ? -vn*bounce : 0);
    let nearest, radius = 64;
    for (const q of previous) {
      const distance = (p.x-q.x)**2+(p.y-q.y)**2;
      if (distance < radius && !matched.has(q)) { nearest = q; radius = distance; }
    }
    if (nearest) {
      matched.add(nearest);
      p.normal = nearest.normal ?? 0;
      p.tangent = nearest.tangent ?? 0;
    }
  }
}

function solveContact(p) {
  const {nx,ny} = p;
  const normal = Math.max(0, p.normal+(p.bias-along(p,nx,ny)-p.softness*p.normal)*p.nMass);
  impulse(p, nx*(normal-p.normal), ny*(normal-p.normal));
  p.normal = normal;
  const limit = p.friction*normal;
  const tangent = clamp(p.tangent-along(p,-ny,nx)*p.tMass, -limit, limit);
  impulse(p, -ny*(tangent-p.tangent), nx*(tangent-p.tangent));
  p.tangent = tangent;
}

function anchor(b, p) {
  if (!b) return { x:p.x, y:p.y };
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  return { x:b.x+c*p.x-s*p.y, y:b.y+s*p.x+c*p.y };
}

function linkAnchor(j) {
  const q = anchor(j.b,j.anchorB);
  if (j.support) {
    q.x += j.support.x;
    q.y += j.support.y;
  }
  return q;
}

function advanceSupport(j, dt) {
  const s = j.support;
  const frequency = 2*Math.PI*3;
  const decay = Math.exp(-frequency*dt);
  // Closed-form step of a critically damped support returning to rest.
  const dx = s.vx+frequency*s.x, dy = s.vy+frequency*s.y;
  s.x = (s.x+dx*dt)*decay;
  s.y = (s.y+dy*dt)*decay;
  s.vx = (s.vx-frequency*dx*dt)*decay;
  s.vy = (s.vy-frequency*dy*dt)*decay;
  if (Math.abs(s.x)+Math.abs(s.y)+dt*(Math.abs(s.vx)+Math.abs(s.vy)) < 0.0001) j.support = undefined;
}

function prepareLink(j, dt) {
  const p = anchor(j.a,j.anchorA), q = linkAnchor(j);
  const dx = q.x-p.x, dy = q.y-p.y, length = Math.hypot(dx,dy);
  j.nx = length ? dx/length : 1;
  j.ny = length ? dy/length : 0;
  j.ra = lever(j.a,p.x,p.y);
  j.rb = lever(j.b,q.x,q.y);
  const inv = inverseMass(j,j.nx,j.ny), error = length-j.length;
  j.gamma = j.sum = 0;
  j.bias = (j.rope && error < 0 ? 1 : 0.2)*error/dt;
  if (j.frequency && !(j.rope && error < 0)) {
    const omega = 2*Math.PI*j.frequency;
    const damping = 2*j.damping*omega, stiffness = omega*omega;
    j.gamma = inv/(dt*(damping+dt*stiffness));
    j.bias = error*stiffness/(damping+dt*stiffness);
  }
  j.mass = 1/(inv+j.gamma);
  j.limit = j.maxForce*dt;
}

function solveLink(j) {
  const {nx,ny} = j;
  const supportSpeed = j.support ? j.support.vx*nx+j.support.vy*ny : 0;
  const delta = -(along(j,nx,ny)+supportSpeed+j.bias+j.gamma*j.sum)*j.mass;
  const sum = clamp(j.sum+delta,-j.limit,j.rope ? 0 : j.limit);
  impulse(j,nx*(sum-j.sum),ny*(sum-j.sum));
  j.sum = sum;
}

export class World {
  constructor({gx=0,gy=1000,cell=64,iterations=9,sleep=true} = {}) {
    if (![gx,gy,cell].every(Number.isFinite) || cell <= 0 ||
        !Number.isInteger(iterations) || iterations < 1) throw new RangeError('Invalid world parameters');
    Object.assign(this,{gx,gy,cell,iterations,sleep});
    this.bodies = [];
    this.links = [];
    this.contacts = new Map();
    this.nextId = 1;
    this.tick = 0;
    this.time = 0;
    this.impactListeners = new Set();
  }

  onImpact(listener) {
    if (typeof listener !== 'function') throw new TypeError('Invalid impact listener');
    this.impactListeners.add(listener);
    return () => this.impactListeners.delete(listener);
  }

  add(options) {
    const b = new Body(this.nextId++,options);
    this.bodies.push(b);
    if (!b.inv) this.wake();
    return b;
  }

  remove(body) {
    const index = this.bodies.indexOf(body);
    if (index < 0) return;
    this.bodies.splice(index,1);
    this.links = this.links.filter(j => j.a !== body && j.b !== body);
    this.contacts.clear();
    this.wake();
  }

  wake(body) {
    for (const b of body?.inv ? [body] : this.bodies) {
      b.sleeping = false;
      b.idle = 0;
    }
  }

  sleepBody(body) {
    if (!body.inv) return;
    body.sleeping = true;
    body.idle = 0.65;
    body.vx = body.vy = body.spin = 0;
    body.px = body.x;
    body.py = body.y;
    body.pa = body.angle;
  }

  move(body,x,y,angle=body.angle) {
    if (![x,y,angle].every(Number.isFinite)) throw new RangeError('Invalid pose');
    body.x = body.px = x;
    body.y = body.py = y;
    body.angle = body.pa = angle;
    body.update();
    this.contacts.clear();
    this.wake();
  }

  kick(body,vx,vy,spin=0) {
    if (!body.inv) return;
    if (![vx,vy,spin].every(Number.isFinite)) throw new RangeError('Invalid velocity');
    body.vx += vx;
    body.vy += vy;
    body.spin += spin;
    this.wake(body);
  }

  setMaterial(body, material) {
    if (!this.bodies.includes(body)) throw new RangeError('Body is outside this world');
    Object.assign(body,coefficients(material));
    this.contacts.clear();
    this.wake();
  }

  gravity(x,y) {
    if (![x,y].every(Number.isFinite)) throw new RangeError('Invalid gravity');
    this.gravityTween = undefined;
    this.#setGravity(x,y);
  }

  #setGravity(x,y) {
    if (x === this.gx && y === this.gy) return;
    this.gx = x;
    this.gy = y;
    this.wake();
  }

  gravityTo({x,y}, ms=600) {
    if (![x,y,ms].every(Number.isFinite) || ms < 0) throw new RangeError('Invalid gravity transition');
    if (!ms) { this.gravity(x,y); return; }
    this.gravityTween = {x,y,fromX:this.gx,fromY:this.gy,ms,elapsed:0};
  }

  link(a,b=null,options={}) {
    const { anchorA={x:0,y:0}, anchorB={x:0,y:0}, frequency=0,
      damping=0.8, rope=false, maxForce=Infinity } = options;
    if (a === b || (!a.inv && !b?.inv) || !this.bodies.includes(a) || (b && !this.bodies.includes(b))) {
      throw new RangeError('A link needs distinct bodies in this world and a dynamic endpoint');
    }
    const p = anchor(a,anchorA), q = anchor(b,anchorB);
    const { length=Math.hypot(q.x-p.x,q.y-p.y) } = options;
    if (![p.x,p.y,q.x,q.y,length,frequency,damping].every(Number.isFinite) ||
        length < 0 || frequency < 0 || damping < 0 || !(maxForce >= 0)) {
      throw new RangeError('Invalid link parameters');
    }
    const j = {a,b,anchorA,anchorB,frequency,damping,rope,length,maxForce};
    this.links.push(j);
    this.wake(a.inv ? a : b);
    return j;
  }

  unlink(j) {
    const i = this.links.indexOf(j);
    if (i < 0) return;
    this.links.splice(i,1);
    this.wake(j.a.inv ? j.a : j.b);
  }

  pulseLink(link,{x,y}) {
    if (!this.links.includes(link) || link.b || ![x,y].every(Number.isFinite)) {
      throw new RangeError('Expected a world-anchored link and finite pulse');
    }
    const s = link.support ??= {x:0,y:0,vx:0,vy:0};
    s.vx += x;
    s.vy += y;
    this.wake(link.a);
  }

  linkAnchor(link) {
    return linkAnchor(link);
  }

  detect() {
    const grid = new Map(), large = [];
    const contacts = new Map();
    const pair = (a,b) => {
      if (a.collisionEnabled === false || b.collisionEnabled === false ||
          (!a.inv && !b.inv) || a.left > b.right || b.left > a.right ||
          a.top > b.bottom || b.top > a.bottom) return;
      if (a.id > b.id) [a,b] = [b,a];
      const m = collide(a,b);
      if (!m) return;
      join(a,b);
      m.a = a;
      m.b = b;
      contacts.set(`${a.id}:${b.id}`,m);
    };
    for (const b of this.bodies) {
      b.col = Math.floor(b.left/this.cell);
      b.row = Math.floor(b.top/this.cell);
      const right = Math.floor(b.right/this.cell), bottom = Math.floor(b.bottom/this.cell);
      b.large = ![b.col,b.row,right,bottom].every(Number.isSafeInteger) ||
        (right-b.col+1)*(bottom-b.row+1) > 128;
      if (b.large) {
        large.push(b);
        continue;
      }
      for (let x=b.col; x<=right; x++) {
        for (let y=b.row; y<=bottom; y++) {
          const key = `${x}:${y}`;
          const bucket = grid.get(key);
          if (!bucket) { grid.set(key,[b]); continue; }
          for (const a of bucket) {
            // Visit a pair only in its first common cell.
            if (x === Math.max(a.col,b.col) && y === Math.max(a.row,b.row)) pair(a,b);
          }
          bucket.push(b);
        }
      }
    }
    for (const a of large) for (const b of this.bodies) {
      if (b !== a && (b.id > a.id || !b.large)) pair(a,b);
    }
    return contacts;
  }

  step(dt,substeps=1,beforeContact=0) {
    if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('Invalid timestep');
    if (!Number.isSafeInteger(substeps) || substeps < 1 || !(beforeContact >= 0 && beforeContact < dt)) {
      throw new RangeError('Invalid substeps');
    }
    const start = this.time, tick = this.tick+1;
    if (beforeContact) this.#solveStep(beforeContact,start+beforeContact,tick,true);
    const remainder = dt-beforeContact;
    for (let step=1;step<=substeps;step++) {
      const time = step === substeps ? start+dt : start+beforeContact+remainder*step/substeps;
      this.#solveStep(remainder/substeps,time,tick,step === 1 && !beforeContact);
    }
  }

  #solveStep(dt,time,tick,rememberPose) {
    if (this.gravityTween) {
      const t = this.gravityTween;
      t.elapsed += dt*1000;
      if (t.elapsed >= t.ms-EPS) this.gravity(t.x,t.y);
      else {
        const progress = t.elapsed/t.ms;
        const mix = progress*progress*(3-2*progress);
        this.#setGravity((1-mix)*t.fromX+mix*t.x,(1-mix)*t.fromY+mix*t.y);
      }
    }
    for (const j of this.links) if (j.support) {
      advanceSupport(j,dt);
      this.wake(j.a);
    }
    for (const b of this.bodies) {
      b.parent = b;
      b.rank = 0;
      if (rememberPose) {
        b.px = b.x;
        b.py = b.y;
        b.pa = b.angle;
      }
      b.active = !this.sleep;
      b.quiet = Infinity;
    }
    const contacts = this.detect();
    for (const j of this.links) join(j.a,j.b);
    for (const b of this.bodies) if (b.inv && !b.sleeping) root(b).active = true;
    for (const b of this.bodies) if (b.inv && root(b).active) {
      b.sleeping = false;
      b.vx += this.gx*dt;
      b.vy += this.gy*dt;
    }
    const points = [], links = [], measureImpact = this.impactListeners.size > 0;
    for (const [key,m] of contacts) {
      if (!(m.a.inv && !m.a.sleeping || m.b.inv && !m.b.sleeping)) continue;
      contactPoints(m,this.contacts.get(key),dt,measureImpact);
      for (const p of m.points) points.push(p);
    }
    // Measure incoming velocities before applying any cached contact impulses.
    for (const p of points) {
      impulse(p,p.nx*p.normal-p.ny*p.tangent,p.ny*p.normal+p.nx*p.tangent);
    }
    for (const j of this.links) {
      if ((j.a.inv ? j.a : j.b).sleeping) continue;
      prepareLink(j,dt);
      links.push(j);
    }
    for (let i=0; i<this.iterations; i++) {
      for (const j of links) solveLink(j);
      for (const p of points) solveContact(p);
    }
    for (const b of this.bodies) if (b.inv && !b.sleeping) {
      b.x += b.vx*dt;
      b.y += b.vy*dt;
      b.angle += b.spin*dt;
      b.update();
      b.idle = b.vx*b.vx+b.vy*b.vy < 9 && Math.abs(b.spin) < 0.09 ? b.idle+dt : 0;
      const group = root(b);
      group.quiet = Math.min(group.quiet,b.idle);
    }
    if (this.sleep) for (const b of this.bodies) {
      if (b.inv && !b.sleeping && root(b).quiet >= 0.65) {
        b.sleeping = true;
        b.vx = b.vy = b.spin = 0;
      }
    }
    this.contacts = contacts;
    this.tick = tick;
    this.time = time;
    if (measureImpact) {
      const listeners = [...this.impactListeners];
      const events = points.filter(p => p.normal > 0).map(p => ({
        a:p.a, b:p.b, point:{x:p.x,y:p.y}, normal:{x:p.nx,y:p.ny},
        impulse:Math.hypot(p.normal,p.tangent), normalImpulse:p.normal, tangentImpulse:p.tangent,
        closingSpeed:p.closingSpeed, slipSpeed:p.slipSpeed, tick:this.tick, time:this.time, dt,
        gravity:{x:this.gx+0,y:this.gy+0}
      }));
      for (const event of events) for (const listener of listeners) listener(event);
    }
  }
}

export { bindDOM, contain, dragPointer, fixedLoop, tiltGravity, orientationToGravity, requestOrientation } from './browser.js';
