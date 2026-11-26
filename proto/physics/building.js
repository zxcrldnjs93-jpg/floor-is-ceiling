import { World } from './engine.js';
import { playImpactTrack } from './replay.js';

export const BUILDING_DT = 1/120;
export const THUMP_WINDOW = 0.25;
export const MAX_ANGULAR_SPEED = 225*Math.PI/180;
export const MAX_LAMP_ANGLE = 0.6;
export const STANDARD_BALL = Object.freeze({radius:14,mass:1,restitution:0.16});
export const MAT_PRESET = Object.freeze({width:144,height:5,stiffness:10_000,damping:100});
export const MAX_THROW_SPEED = 600;
const WIDTH = 480, ROOM_HEIGHT = 158, SLAB_HEIGHT = 12, GRAVITY = 920;
const HEIGHT = 3*ROOM_HEIGHT+4*SLAB_HEIGHT;
const REFERENCE_Y = SLAB_HEIGHT+ROOM_HEIGHT/2;
const SCRAPE_REFERENCE_FORCE = 800;
const MAX_SCRAPE_INDEX = 200;
const CHAIR_TRAVEL_SECONDS = 0.5;
const CHAIR_DRAG_SECONDS = 0.65;
const CHAIR_CUE_DELAY = 0.6;
const CHAIR_CUE_X_FRACTION = 0.8;
const MAT_SUBSTEPS = 32;
const POINTER_BUFFER_SECONDS = 0.033;
const MAX_QUEUED_DROPS = 1;
const DROP_ACTIONS = new Set(['dropBall','matDrop','throwBall','tap']);
const LAMP_PULSE_WINDOW = 0.12;
const LAMP_PULSE_LIMIT = 1500;
const LAMP_VERTICAL_RATIO = 0.24;
const EPS = 1e-9;
const clamp = (x, min, max) => Math.max(min,Math.min(max,x));
const unitRange = value => clamp(value,0,1);

function limitVector(x,y,max) {
  const length = Math.hypot(x,y);
  if (!Number.isFinite(length)) {
    const largest = Math.max(Math.abs(x),Math.abs(y));
    const nx = x/largest, ny = y/largest;
    const scale = max/Math.hypot(nx,ny);
    return [nx*scale,ny*scale];
  }
  const scale = Math.min(1,max/(length || 1));
  return [x*scale,y*scale];
}

export function angleForProgress(progress) {
  if (!Number.isFinite(progress)) throw new RangeError('Invalid rotation progress');
  if (progress >= 0.95) return 2*Math.PI;
  return Math.PI*(unitRange((progress-0.25)/0.30)+unitRange((progress-0.75)/0.20));
}

export function thumpIndex(force, referenceForce) {
  return Math.round(clamp(100*force/referenceForce,0,999));
}

function limitScrapeIndex(type,index) {
  return type === 'scrape' ? clamp(index,0,MAX_SCRAPE_INDEX) : index;
}

function dragScrapeIndex({force,dragDistance,dragTargetDistance},duration) {
  // Credit the commanded stroke only where it produced real chair movement.
  const stroke = Math.min(dragTargetDistance,4*dragDistance);
  const base = 100*unitRange(stroke/55)+40*unitRange(force/SCRAPE_REFERENCE_FORCE);
  const strongForce = unitRange((force-1600)/750);
  const longTravel = unitRange((dragDistance-60)/100);
  const sustainedSpeed = unitRange((dragDistance/duration-50)/40);
  return Math.round(base+60*Math.min(strongForce,longTravel,sustainedSpeed));
}

function makeWorld() {
  return new World({gy:GRAVITY,cell:44,iterations:12});
}

function route(slab, normal, gravity) {
  const side = Math.abs(normal.y) < 0.5 ? null : normal.y < 0 ? 'above' : 'below';
  const alignment = (side === 'above' ? -1 : 1)*gravity.y;
  const face = !side || Math.abs(alignment) <= EPS ? 'edge' : alignment < 0 ? 'top' : 'bottom';
  return {
    side, face,
    sourceRoom:side === 'above' ? slab.above : side === 'below' ? slab.below : null,
    receiverRoom:face === 'top' ? (side === 'above' ? slab.below : slab.above) : null
  };
}

function slabContact(hit, byBody) {
  const first = byBody.get(hit.a), slab = first ?? byBody.get(hit.b);
  if (!slab) return;
  const body = first ? hit.b : hit.a;
  if (!body.inv) return;
  const sign = first ? 1 : -1;
  const slabNormal = {x:sign*hit.normal.x+0,y:sign*hit.normal.y+0};
  const mat = slabNormal.y < -0.5 && Boolean((first ? hit.a : hit.b).topSpring);
  return {...hit,...route(slab,slabNormal,hit.gravity),slab,slabNormal,body,mat};
}

function pairKey(a,b,actionId) {
  return actionId === undefined ? `${a.id}:${b.id}` : `${a.id}:${b.id}:${actionId}`;
}

function slabPairs(contacts, byBody, drop, drag) {
  const touching = new Set();
  for (const {a,b} of contacts.values()) {
    const first = byBody.get(a), slab = first ?? byBody.get(b);
    const body = first ? b : a;
    const action = drop?.bodyId === body.id ? drop : drag?.bodyId === body.id ? drag : undefined;
    if (slab && body.inv) touching.add(pairKey(slab.body,body,action?.actionId));
  }
  return touching;
}

class ContactWindows {
  constructor(touching = new Set()) {
    this.touching = touching;
    this.windows = new Map();
  }

  startScrape(slab,body,time) {
    this.windows.set(pairKey(slab.body,body),{start:time,type:'scrape'});
  }

  takePeak(slab,body,actionId) {
    const key = pairKey(slab.body,body,actionId);
    const peak = this.windows.get(key)?.received;
    this.windows.delete(key);
    return peak;
  }

  advance(time, touching, impulses) {
    const complete = [];
    for (const [key,window] of this.windows) {
      if (time+EPS >= window.start+THUMP_WINDOW) {
        this.windows.delete(key);
        if (window.peak) complete.push(window);
      }
    }
    for (const event of impulses) {
      if (event.time < time-EPS) touching.add(pairKey(event.slab.body,event.body,event.actionId));
    }
    for (const key of touching) {
      if (!this.touching.has(key) && !this.windows.has(key)) this.windows.set(key,{start:time});
    }
    this.touching = touching;

    const steps = new Map();
    for (const contact of impulses) {
      if (contact.action === 'dragChair' && !contact.scrape) continue;
      const {slab,body,actionId,normalImpulse,tangentImpulse,point} = contact;
      const key = pairKey(slab.body,body,actionId);
      let window = this.windows.get(key);
      if (contact.scrape && contact.slipSpeed >= 6 && tangentImpulse) {
        if (window?.type !== 'scrape') {
          window = {start:time,type:'scrape'};
          this.windows.set(key,window);
        }
      }
      if (!window) continue;
      if (contact.scrape && contact.slipSpeed < 6) continue;
      const friction = Math.abs(tangentImpulse);
      const weight = window.type === 'scrape' ? friction : normalImpulse;
      if (!weight || (contact.scrape && window.type !== 'scrape')) continue;
      const sideKey = `${key}:${contact.side}:${contact.time}`;
      if (!steps.has(sideKey)) steps.set(sideKey,{window,contact,impulse:0,normal:0,friction:0,x:0,y:0,mat:false});
      const step = steps.get(sideKey);
      step.impulse += weight;
      step.normal += normalImpulse;
      step.friction += friction;
      step.x += point.x*weight;
      step.y += point.y*weight;
      step.mat ||= contact.mat;
    }
    for (const {window,contact,impulse,normal,friction,x,y,mat} of steps.values()) {
      const peak = {
        slab:contact.slab.id, bodyId:contact.body.id, point:{x:x/impulse,y:y/impulse},
        gravity:{...contact.gravity}, side:contact.side, face:contact.face,
        sourceRoom:contact.sourceRoom, receiverRoom:contact.receiverRoom,
        type:window.type ?? 'impact', mat, normalImpulse:normal, frictionImpulse:friction,
        force:impulse/contact.dt, dt:contact.dt, peakTime:contact.time
      };
      const {action,actionId,inputTime,heightDrop,dropY,matGain} = contact;
      if (actionId !== undefined) Object.assign(peak,{action,actionId,inputTime,heightDrop,dropY,matGain});
      if (!window.peak || peak.force > window.peak.force) window.peak = peak;
      if (peak.receiverRoom !== null && (!window.received || peak.force > window.received.force)) {
        window.received = peak;
      }
    }
    return complete;
  }
}

function addMat(world,slab) {
  const {width,height,stiffness,damping} = MAT_PRESET;
  return world.add({fixed:true,width,height,x:slab.body.x,y:slab.body.top-height/2,
    material:'mat',topSpring:{stiffness,damping}});
}

function stepMatWorld(world,dt,mat,ball) {
  const reachesMat = mat && !ball.sleeping && world.gy > 0 && Math.abs(world.gx) < EPS && ball.y < mat.top &&
    Math.max(ball.right,ball.right+ball.vx*dt) >= mat.left &&
    Math.min(ball.left,ball.left+ball.vx*dt) <= mat.right &&
    ball.bottom+Math.max(0,ball.vy+world.gy*dt)*dt >= mat.top;
  if (!reachesMat) return world.step(dt);
  const gap = mat.top-ball.bottom;
  // The free segment uses the same semi-implicit gravity update as the world.
  const touch = gap > 0 ? 2*gap/(ball.vy+Math.sqrt(ball.vy**2+4*world.gy*gap)) : 0;
  // Step a distance smaller than solver tolerances past the tangent so it is detected.
  const beforeContact = touch > EPS ? Math.min(dt*(1-1e-9),touch+1e-10) : 0;
  const substeps = Math.ceil(MAT_SUBSTEPS*(dt-beforeContact)/dt);
  world.step(dt,substeps,beforeContact);
}

function referenceDrop(dt, padded=false, y=REFERENCE_Y) {
  const world = makeWorld();
  const body = world.add({fixed:true,width:WIDTH,height:SLAB_HEIGHT,
    x:WIDTH/2,y:ROOM_HEIGHT+SLAB_HEIGHT/2,material:'hardFloor'});
  const slab = {id:'reference',above:7,below:6,body};
  const byBody = new Map([[body,slab]]);
  const mat = padded ? addMat(world,slab) : undefined;
  if (mat) byBody.set(mat,slab);
  const ball = world.add({...STANDARD_BALL,x:WIDTH/2,y:y-SLAB_HEIGHT});
  const windows = new ContactWindows();
  const impacts = [];
  world.onImpact(hit => {
    const contact = slabContact(hit,byBody);
    if (contact) impacts.push(contact);
  });
  for (let time=0; time<2; time+=dt) {
    stepMatWorld(world,dt,mat,ball);
    const [first] = windows.advance(world.time,slabPairs(world.contacts,byBody),impacts);
    if (first) return first.peak;
    impacts.length = 0;
  }
  throw new Error('Reference ball did not land');
}

function comparisonY(y) {
  if (!Number.isFinite(y)) throw new RangeError('Invalid comparison height');
  return clamp(y,SLAB_HEIGHT+STANDARD_BALL.radius,SLAB_HEIGHT+ROOM_HEIGHT-STANDARD_BALL.radius-5.5);
}

export function compareMatDrop({dt=BUILDING_DT,y=REFERENCE_Y}={}) {
  y = comparisonY(y);
  const baseline = referenceDrop(dt);
  const reference = baseline.force;
  const bare = y === REFERENCE_Y ? baseline : referenceDrop(dt,false,y);
  const padded = referenceDrop(dt,true,y);
  const gain = Math.max(1,bare.force/reference);
  return {
    y,bare:{...bare,index:thumpIndex(bare.force*gain,reference)},
    padded:{...padded,index:thumpIndex(padded.force*gain,reference)},
    reduction:100*(1-padded.force/bare.force)
  };
}

function beam(world,id,index,above,below) {
  const y = SLAB_HEIGHT/2+index*(ROOM_HEIGHT+SLAB_HEIGHT);
  const body = world.add({fixed:true,width:WIDTH,height:SLAB_HEIGHT,x:WIDTH/2,y,material:'hardFloor'});
  return {id,y,above,below,body};
}

function furnish(world, room, name, x, options) {
  const body = world.add({x,y:room.bottom-(options.radius ?? options.height/2)+0.001,...options});
  world.sleepBody(body);
  room.bodies.push(body);
  room.props[name] = body;
  return body;
}

function clearDropColumn(room, ball, requested, y, width, throughToFloor=true) {
  const radius = ball.shape.radius;
  const clearance = radius+1;
  const preferred = clamp(requested,clearance,width-clearance);
  const bottom = throughToFloor ? room.bottom : y+radius;
  // Expand each blocking footprint by the ball radius for a clear path to the slab.
  const blocked = room.bodies
    .filter(body => body !== ball && body.collisionEnabled !== false && body.bottom >= y-radius && body.top <= bottom)
    .map(body => [body.left-clearance,body.right+clearance]);
  let nearest, distance = Infinity;
  for (const x of [preferred,clearance,width-clearance,...blocked.flat()]) {
    if (x < clearance || x > width-clearance || blocked.some(([left,right]) => x > left && x < right)) continue;
    const gap = Math.abs(x-preferred);
    if (gap < distance) {
      distance = gap;
      nearest = x;
    }
  }
  return nearest;
}

function referenceChairImpact(dt) {
  const preview = createBuilding({dt});
  preview.input({type:'nudgeChair'});
  const tape = preview.recordings.chair;
  for (let i=0;i<Math.ceil(1.5/dt) && !tape.length;i++) preview.step();
  return tape[0];
}

class Building {
  #chairCuePlayed = false;
  #chairCueAlignment;
  #referenceChair;

  constructor(dt) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1/60) throw new RangeError('Invalid building timestep');
    this.dt = dt;
    this.width = WIDTH;
    this.height = HEIGHT;
    this.progress = this.angle = 0;
    this.world = makeWorld();
    this.lampWorld = new World({gy:810});
    this.slabs = [
      beam(this.world,'roof',0,null,7), beam(this.world,'6/7',1,7,6),
      beam(this.world,'6/5',2,6,5), beam(this.world,'below-5',3,5,null)
    ];
    for (const x of [-24,WIDTH+24]) this.world.add({fixed:true,width:48,height:HEIGHT,x,y:HEIGHT/2});
    this.rooms = new Map([7,6,5].map((id,i) => [id,{
      id, top:this.slabs[i].y+SLAB_HEIGHT/2, bottom:this.slabs[i+1].y-SLAB_HEIGHT/2,
      props:{}, bodies:[]
    }]));
    const upper = this.rooms.get(7), middle = this.rooms.get(6), lower = this.rooms.get(5);
    // Scale both cups by area to preserve their existing mass per unit area.
    const cupSize = {width:14,height:18};
    const cupArea = cupSize.width*cupSize.height;
    furnish(this.world,upper,'ball',310,STANDARD_BALL);
    furnish(this.world,upper,'chair',375,{width:49,height:64,mass:1.3,friction:0.43});
    furnish(this.world,upper,'cup',440,{...cupSize,mass:0.46*cupArea/(23*30)});
    furnish(this.world,middle,'chair',163,{width:52,height:62,mass:1.6,friction:0.43});
    furnish(this.world,middle,'cup',366,{...cupSize,mass:0.5*cupArea/(24*31)});
    furnish(this.world,lower,'plant',326,{width:34,height:48,mass:0.9});
    this.roomHomes = [upper,middle,lower].flatMap((room,index) => Object.values(room.props).map(body => ({
      body,slab:this.slabs[index+1],x:body.x,y:body.y,left:body.left,right:body.right
    })));
    this.returnPoseReady = true;
    this.copyBlocks = [
      furnish(this.world,lower,'copy',127,{width:118,height:25,y:lower.top+46,mass:0.65}),
      furnish(this.world,upper,'copy',290,{width:104,height:24,y:upper.top+48,mass:0.65})
    ];
    this.copyHomes = this.copyBlocks.map(body => body.pose());
    this.#setCopyReleased(false);
    for (const room of [middle,lower]) {
      const anchorB = {x:WIDTH/2,y:room.top+1}, length = 55;
      room.lamp = this.lampWorld.add({radius:9,x:anchorB.x,y:anchorB.y+length,mass:1.2});
      room.cable = this.lampWorld.link(room.lamp,null,{anchorB,length});
    }

    this.reference = referenceDrop(dt);
    this.referenceForce = this.reference.force;
    this.slabByBody = new Map(this.slabs.map(slab => [slab.body,slab]));
    this.world.step(dt);
    this.windows = new ContactWindows(slabPairs(this.world.contacts,this.slabByBody));
    this.contacts = [];
    this.listeners = {contact:new Set(),thump:new Set(),receive:new Set(),inputCancelled:new Set()};
    this.recordings = {upper:[],chair:[]};
    this.dropQueue = [];
    this.pendingDrops = new Map();
    this.nextActionId = 1;
    this.world.onImpact(hit => {
      const contact = slabContact(hit,this.slabByBody);
      if (!contact) return;
      const drop = this.activeDrop;
      if (drop?.bodyId === contact.body.id) {
        const {action,actionId,inputTime,heightDrop,y,matGain} = drop;
        Object.assign(contact,{action,actionId,inputTime,heightDrop,dropY:y,matGain});
        if (contact.slab.id === '6/7' && contact.sourceRoom === 7 && contact.receiverRoom === 6) {
          drop.landed = true;
        }
      }
      const drag = this.chairDrag;
      if (drag?.bodyId === contact.body.id && !drag.settled) {
        const {action,actionId,inputTime} = drag;
        const scrape = Boolean(drag.link) && contact.slab.id === '6/7' &&
          contact.sourceRoom === 7 && contact.receiverRoom === 6;
        Object.assign(contact,{action,actionId,inputTime,scrape});
      }
      this.contacts.push(contact);
    });
  }

  subscribe(type, listener) {
    this.listeners[type].add(listener);
    return () => this.listeners[type].delete(listener);
  }
  onContact(listener) { return this.subscribe('contact',listener); }
  onThump(listener) { return this.subscribe('thump',listener); }
  onReceive(listener) { return this.subscribe('receive',listener); }
  onInputCancelled(listener) { return this.subscribe('inputCancelled',listener); }

  emit(type,event) {
    for (const listener of [...this.listeners[type]]) listener(event);
  }

  get listening() {
    if (this.sensor) return this.sensor.listening;
    return this.progress >= 0.55 && this.progress <= 0.75 && Math.abs(this.angle-Math.PI) < EPS;
  }

  get canInput() {
    if (this.sensor || !this.returnPoseReady) return false;
    const atRest = Math.abs(this.angle-angleForProgress(this.progress)) < EPS;
    return atRest && (this.progress < 0.25 || this.progress >= 0.95) &&
      (!this.player || this.player.track === 'upper');
  }

  canInputFor(type) {
    if (type === 'releaseChair') return Boolean(this.chairDrag?.link);
    if (DROP_ACTIONS.has(type) && this.dropQueue.length >= MAX_QUEUED_DROPS) return false;
    return this.canInput && (!this.player || type === 'nudgeChair');
  }

  get hasPendingDrop() {
    return this.pendingDrops.size > 0;
  }

  setProgress(progress) {
    if (!Number.isFinite(progress)) throw new RangeError('Invalid rotation progress');
    const previous = this.progress;
    const wasListening = this.listening;
    this.progress = unitRange(progress);
    if (this.sensor) return;
    if (wasListening && !this.listening) this.#leaveListening();
    if (angleForProgress(previous) !== angleForProgress(this.progress)) {
      this.#clearUpperInputs('rotation');
    }
  }

  #clearUpperInputs(reason) {
    this.stopReplay();
    const pending = [...this.pendingDrops.values()];
    this.pendingDrops.clear();
    this.dropQueue.length = 0;
    this.activeDrop = undefined;
    this.#releaseChair();
    this.chairDrag = undefined;
    for (const command of pending) this.#cancelDrop(command,reason);
  }

  #cancelDrop({action,actionId,inputTime},reason) {
    this.pendingDrops.delete(actionId);
    const ball = this.rooms.get(7).props.ball;
    for (const slab of this.slabs) this.windows.takePeak(slab,ball,actionId);
    this.emit('inputCancelled',{action,actionId,inputTime,reason});
  }

  setSensorGravity({x,y},{listening=this.sensor?.listening ?? false}={}) {
    if (![x,y].every(Number.isFinite)) throw new RangeError('Invalid sensor gravity');
    if (!this.sensor) {
      if (Math.abs(Math.sin(this.angle/2)) > EPS) return false;
      this.sensor = {listening:false};
      this.returnPoseReady = false;
      this.#clearUpperInputs('sensor');
    }
    if (this.sensor.listening && listening) return true;
    if (this.sensor.listening) this.#leaveListening();
    this.sensor.listening = listening;
    this.world.gravity(...limitVector(x,y,GRAVITY));
    return true;
  }

  clearSensorGravity() {
    if (!this.sensor) return false;
    if (this.sensor.listening) this.#leaveListening();
    this.sensor = undefined;
    this.stopReplay();
    this.world.gravity(0,GRAVITY);
    this.settleReturnedRooms();
    return true;
  }

  #leaveListening() {
    this.#chairCuePlayed = false;
    this.stopReplay();
    this.#resetLamps();
  }

  sleepRoom(id) {
    const room = this.rooms.get(id);
    for (const body of room.bodies) this.world.sleepBody(body);
    if (room.lamp) this.lampWorld.sleepBody(room.lamp);
  }

  wakeRoom(id) {
    const room = this.rooms.get(id);
    for (const body of room.bodies) this.world.wake(body);
    if (room.lamp) this.lampWorld.wake(room.lamp);
  }

  #setCopyReleased(released) {
    this.copyReleased = released;
    for (const body of this.copyBlocks) body.collisionEnabled = released;
  }

  resetCopyBlocks() {
    if (Math.abs(Math.sin(this.angle/2)) > EPS ||
        Math.abs(this.angle-angleForProgress(this.progress)) > EPS) return false;
    for (const [i,body] of this.copyBlocks.entries()) {
      Object.assign(body,this.copyHomes[i]);
      body.update();
      this.world.sleepBody(body);
    }
    for (const [key,{a,b}] of this.world.contacts) {
      if (this.copyBlocks.includes(a) || this.copyBlocks.includes(b)) this.world.contacts.delete(key);
    }
    this.#setCopyReleased(false);
    return true;
  }

  settleReturnedRooms() {
    if (this.sensor || this.hasPendingDrop || this.chairDrag?.link || Math.abs(Math.sin(this.angle/2)) > EPS ||
        Math.abs(this.angle-angleForProgress(this.progress)) > EPS) return false;
    this.activeDrop = undefined;
    this.chairDrag = undefined;
    const touching = new Set();
    for (const {body,slab,x,y,left,right} of this.roomHomes) {
      const onMat = slab === this.slabs[1] && this.mat && left < this.mat.right && right > this.mat.left;
      Object.assign(body,{x,y:onMat ? y-MAT_PRESET.height : y,angle:0});
      body.update();
      this.world.sleepBody(body);
      touching.add(pairKey(slab.body,body));
    }
    this.world.contacts.clear();
    this.windows = new ContactWindows(touching);
    this.returnPoseReady = true;
    return true;
  }

  #releaseDrop(command) {
    const room = this.rooms.get(7), ball = room.props.ball;
    const x = clearDropColumn(room,ball,command.x,command.y,this.width,command.action !== 'throwBall');
    if (x === undefined) return false;
    ball.vx = command.vx;
    ball.vy = command.vy;
    ball.spin = 0;
    this.world.move(ball,x,command.y,0);
    this.activeDrop = command;
    return true;
  }

  #grabChair(x,timeMs) {
    if (!Number.isFinite(x)) throw new RangeError('Invalid chair position');
    if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new RangeError('Invalid pointer time');
    if (this.chairDrag?.link) return false;
    const chair = this.rooms.get(7).props.chair;
    const link = this.world.link(chair,null,{anchorB:{x:chair.x,y:chair.y},
      length:0,frequency:7,maxForce:880});
    this.chairDrag = {link,bodyId:chair.id,action:'dragChair',actionId:this.nextActionId++,
      inputTime:this.world.time,offset:x-chair.x,startX:chair.x,lastX:chair.x,distance:0,targetDistance:0};
    if (timeMs !== undefined) {
      const startTick = this.world.tick+1+Math.ceil(POINTER_BUFFER_SECONDS/this.dt);
      this.chairDrag.pointer = {timeMs,startTick,lastTime:timeMs,samples:[]};
    }
    return true;
  }

  #steerChair(x) {
    if (!Number.isFinite(x)) throw new RangeError('Invalid chair position');
    const drag = this.chairDrag;
    if (!drag?.link) return false;
    const anchor = drag.link.anchorB;
    anchor.x = clamp(x-drag.offset,26,this.width-26);
    this.world.wake(drag.link.a);
    return true;
  }

  #pointerTick(pointer,timeMs) {
    const tick = pointer.startTick+Math.ceil((timeMs-pointer.timeMs)/(this.dt*1000)-EPS);
    if (!Number.isSafeInteger(tick)) throw new RangeError('Invalid pointer time');
    return tick;
  }

  pushPointerSample(timeMs,x) {
    if (![timeMs,x].every(Number.isFinite)) throw new RangeError('Invalid pointer sample');
    const {link,pointer} = this.chairDrag ?? {};
    if (!this.canInputFor('dragChair') || !link || !pointer || pointer.releaseTick || timeMs < pointer.lastTime) return false;
    const tick = this.#pointerTick(pointer,timeMs);
    pointer.lastTime = timeMs;
    const last = pointer.samples.at(-1);
    if (last?.tick === tick) last.x = x;
    else pointer.samples.push({tick,x});
    return true;
  }

  #releaseChair(timeMs) {
    const drag = this.chairDrag;
    if (!drag?.link) return false;
    if (drag.pointer && timeMs !== undefined) {
      if (!Number.isFinite(timeMs)) throw new RangeError('Invalid pointer time');
      if (drag.pointer.releaseTick || timeMs < drag.pointer.lastTime) return false;
      drag.pointer.releaseTick = this.#pointerTick(drag.pointer,timeMs);
      return true;
    }
    const pending = this.windows.takePeak(this.slabs[1],drag.link.a,drag.actionId);
    const peak = pending && pending.force > (drag.peak?.force ?? 0) ? pending : drag.peak;
    this.world.unlink(drag.link);
    drag.link = undefined;
    if (peak) {
      const sample = {...peak,label:'드르륵',dragDistance:drag.distance,dragTargetDistance:drag.targetDistance};
      this.#publishThump(sample,sample,drag.inputTime);
    }
    return true;
  }

  get chairDragDistance() {
    return this.chairDrag?.distance ?? 0;
  }

  settleChairDrag(advance = () => this.step()) {
    const drag = this.chairDrag;
    if (!drag?.link || !drag.preset) return false;
    const {step,totalSteps} = drag.preset;
    for (let i=step; i<totalSteps && drag.link; i++) advance();
    return !drag.link;
  }

  input(command) {
    if (!this.canInputFor(command.type)) return false;
    const {world} = this;
    switch (command.type) {
      case 'dropBall':
      case 'matDrop':
      case 'throwBall':
      case 'tap': {
        const room = this.rooms.get(7), body = room.props.ball;
        const throwing = command.type === 'throwBall';
        const comparing = command.type === 'matDrop';
        const x = comparing ? this.width/2 : command.x ?? (throwing ? body.x : this.width/2);
        const heightDrop = command.type === 'dropBall' && command.y !== undefined;
        const floor = room.bottom-body.shape.radius;
        const baseline = (room.top+room.bottom)/2;
        let requestedY = command.type === 'tap' ? floor-12 : command.y ?? (throwing ? body.y : baseline);
        let matGain = 1;
        if (comparing) {
          if (!this.mat || !this.matTrial) {
            const y = comparisonY(command.y ?? this.bestDrop?.y ?? baseline);
            const gain = y < baseline ? Math.max(1,referenceDrop(this.dt,false,y).force/this.referenceForce) : 1;
            this.matTrial = {y,gain};
          }
          requestedY = this.matTrial.y;
          matGain = this.matTrial.gain;
        }
        const [inputVx,inputVy] = throwing ? [command.vx,command.vy] : [0,0];
        if (![x,requestedY,inputVx,inputVy].every(Number.isFinite)) throw new RangeError('Invalid ball release');
        const [vx,vy] = limitVector(inputVx,inputVy,MAX_THROW_SPEED);
        const y = clamp(requestedY,room.top+body.shape.radius,floor-5.5);
        const drop = {x,y,vx,vy,bodyId:body.id,action:command.type,
          heightDrop,matGain,actionId:this.nextActionId++,inputTime:world.time};
        if (this.dropQueue.length || (this.activeDrop && !this.activeDrop.landed)) this.dropQueue.push(drop);
        else if (!this.#releaseDrop(drop)) return false;
        this.pendingDrops.set(drop.actionId,drop);
        return true;
      }
      case 'grabChair':
        return this.#grabChair(command.x,command.timeMs);
      case 'dragChair': {
        if (command.distance === undefined) return !this.chairDrag?.pointer && this.#steerChair(command.x);
        if (!Number.isFinite(command.distance)) throw new RangeError('Invalid chair distance');
        const {x} = this.rooms.get(7).props.chair;
        if (!this.#grabChair(x)) return false;
        this.chairDrag.preset = {x,distance:clamp(command.distance,-80,80),step:0,
          travelSteps:Math.ceil(CHAIR_TRAVEL_SECONDS/this.dt),totalSteps:Math.ceil(CHAIR_DRAG_SECONDS/this.dt)};
        return true;
      }
      case 'releaseChair':
        return this.#releaseChair(command.timeMs);
      case 'nudgeChair': {
        const chair = this.rooms.get(6).props.chair;
        const side = chair.x < WIDTH/2 ? 1 : -1;
        this.windows.startScrape(this.slabs[2],chair,world.time+this.dt);
        world.kick(chair,side*162,0,side*0.35);
        break;
      }
      case 'mat': {
        const slab = this.slabs[1];
        if (command.enabled && !this.mat) {
          this.mat = addMat(world,slab);
          this.slabByBody.set(this.mat,slab);
        } else if (!command.enabled && this.mat) {
          this.slabByBody.delete(this.mat);
          world.remove(this.mat);
          this.mat = undefined;
        }
        break;
      }
      default: throw new RangeError('Unknown building input');
    }
    return true;
  }

  recording(kind) {
    if (!Object.hasOwn(this.recordings,kind)) throw new RangeError('Unknown recording');
    return structuredClone(this.recordings[kind]);
  }

  stopReplay() {
    this.player = undefined;
    if (!this.#chairCuePlayed) this.#chairCueAlignment = undefined;
  }

  replay(kind, records = this.recording(kind)) {
    return this.#playTrack(kind,records);
  }

  replayChairCue(record) {
    if (!this.listening || this.#chairCuePlayed || this.player?.chairCue) return false;
    record ??= this.recordings.chair.find(event => event.type === 'scrape');
    if (!record) {
      this.#referenceChair ??= referenceChairImpact(this.dt);
      record = this.#referenceChair;
    }
    if (!record) return false;
    const cue = {...record, cue:'s4-chair', label:'6층 의자'};
    if (!this.#playTrack('chair',[cue],{delay:CHAIR_CUE_DELAY,chairCue:true})) return false;
    if (!this.sensor) {
      this.#chairCueAlignment = { tick:this.world.tick,fromX:this.rooms.get(6).props.chair.x };
    }
    return true;
  }

  #alignListeningChair() {
    if (!this.#chairCueAlignment || (!this.player?.chairCue && !this.#chairCuePlayed)) return;
    // Align the body along x during the explanation so the replay shares its position.
    const {tick,fromX} = this.#chairCueAlignment;
    const duration = Math.ceil(CHAIR_CUE_DELAY/this.dt-EPS);
    const progress = unitRange((this.world.tick-tick)/duration);
    const eased = progress*progress*(3-2*progress);
    const chair = this.rooms.get(6).props.chair;
    const target = this.width*CHAIR_CUE_X_FRACTION;
    chair.x = (1-eased)*fromX+eased*target;
    chair.vx = 0;
    chair.update();
  }

  #playTrack(kind,records,{delay=0,chairCue=false}={}) {
    if (kind !== 'upper' && kind !== 'chair') throw new RangeError('Unknown recording');
    if (!Array.isArray(records) || records.some(entry =>
      !Number.isFinite(entry?.time) || !Number.isFinite(entry?.index) || entry.index < 0 ||
      !Number.isFinite(entry?.point?.x) ||
      [entry.force,entry.normalImpulse,entry.frictionImpulse].some(value => value !== undefined && !Number.isFinite(value)) ||
      (entry.action === 'matDrop' && !Number.isFinite(entry.force)))) return false;
    const fromUpper = kind === 'upper', slab = this.slabs[1];
    const normal = {x:0,y:fromUpper ? -1 : 1};
    const gravity = () => ({x:this.world.gx,y:this.world.gy});
    if (route(slab,normal,gravity()).receiverRoom === null) return false;
    if (!fromUpper && !this.listening) return false;
    if (fromUpper && (this.sensor || Math.abs(this.angle-angleForProgress(this.progress)) > EPS)) return false;
    if (!records.length) {
      if (!fromUpper) return false;
      records = [{...this.reference,index:100,time:0}];
    }
    let last = records[0].time, time = delay;
    const timeline = records.map(entry => {
      time += clamp(entry.time-last,0,1.2);
      last = entry.time;
      return {...entry,time,index:limitScrapeIndex(entry.type,entry.index)};
    });
    const player = playImpactTrack(timeline,sample => {
      const g = gravity(), routing = route(slab,normal,g);
      if (routing.receiverRoom === null) return;
      if (chairCue) this.#chairCuePlayed = true;
      const x = chairCue ? this.rooms.get(6).props.chair.x : sample.point.x;
      this.deliver({
        ...sample,...routing,kind:'replay',track:kind,slab:slab.id,gravity:g,
        point:{x,y:slab.y}, playbackTime:sample.time,time:this.world.time
      });
    });
    this.player = Object.assign(player,{track:kind,chairCue});
    return true;
  }

  deliver(event) {
    const room = this.rooms.get(event.receiverRoom);
    if (room?.cable) {
      const dx = event.point.x-room.cable.anchorB.x;
      const score = event.action === 'matDrop' ? 100*event.force/this.referenceForce : event.index;
      const strength = clamp(14*score/(1+Math.abs(dx)/400),0,LAMP_PULSE_LIMIT);
      const pulse = room.lampPulse;
      if (strength > 0 && (!pulse || strength > pulse.strength)) {
        room.lampPulse = {
          until:pulse?.until ?? this.world.time+LAMP_PULSE_WINDOW,
          direction:dx < (event.action === 'matDrop' ? -EPS : 0) ? 1 : -1,strength
        };
      }
    }
    this.emit('receive',event);
  }

  #resetLamps() {
    for (const room of this.rooms.values()) {
      const {lamp,cable} = room;
      if (!lamp) continue;
      room.lampPulse = undefined;
      cable.support = undefined;
      lamp.x = cable.anchorB.x;
      lamp.y = cable.anchorB.y+cable.length;
      lamp.angle = 0;
      lamp.update();
      this.lampWorld.sleepBody(lamp);
    }
  }

  #limitLampSwing(lamp,cable) {
    const anchor = this.lampWorld.linkAnchor(cable);
    const limit = MAX_LAMP_ANGLE-EPS;
    const angle = Math.atan2(lamp.x-anchor.x,lamp.y-anchor.y);
    if (Math.abs(angle) > limit) {
      const boundary = Math.sign(angle)*limit;
      const sin = Math.sin(boundary), cos = Math.cos(boundary);
      const supportX = cable.support?.vx ?? 0, supportY = cable.support?.vy ?? 0;
      const speed = (lamp.vx-supportX)*Math.cos(angle)-(lamp.vy-supportY)*Math.sin(angle);
      const inwardSpeed = speed*angle < 0 ? speed : 0;
      lamp.x = anchor.x+cable.length*sin;
      lamp.y = anchor.y+cable.length*cos;
      lamp.vx = supportX+inwardSpeed*cos;
      lamp.vy = supportY-inwardSpeed*sin;
      lamp.update();
    }
    // The renderer interpolates the bob against the current anchor.
    const previous = Math.atan2(lamp.px-anchor.x,lamp.py-anchor.y);
    if (Math.abs(previous) > limit) {
      const boundary = Math.sign(previous)*limit;
      lamp.px = anchor.x+cable.length*Math.sin(boundary);
      lamp.py = anchor.y+cable.length*Math.cos(boundary);
    }
  }

  #stepLamps(dt) {
    const decay = Math.exp(-0.8*dt);
    for (const room of this.rooms.values()) {
      const {lamp,cable,lampPulse} = room;
      if (!lamp) continue;
      if (lampPulse && this.world.time+EPS >= lampPulse.until) {
        const scale = lampPulse.strength/Math.hypot(1,LAMP_VERTICAL_RATIO);
        this.lampWorld.pulseLink(cable,{x:lampPulse.direction*scale,y:LAMP_VERTICAL_RATIO*scale});
        room.lampPulse = undefined;
      }
      lamp.vx *= decay;
      lamp.vy *= decay;
    }
    this.lampWorld.step(dt);
    for (const {lamp,cable} of this.rooms.values()) if (lamp) this.#limitLampSwing(lamp,cable);
  }

  #dampListeningRoll() {
    const ball = this.rooms.get(7).props.ball;
    for (const {a,b,ny,points} of this.world.contacts.values()) {
      const supported = (a === ball && ny < -0.5) || (b === ball && ny > 0.5);
      if (supported && points.some(point => point.normal > 0)) {
        const decay = Math.exp(-6*this.dt);
        ball.vx *= decay;
        ball.spin *= decay;
        break;
      }
    }
  }

  #reportThump(sample,start) {
    if (sample.action === 'dragChair') {
      const duration = this.world.time-start;
      const index = dragScrapeIndex(sample,duration);
      return {...sample,kind:'live',start,time:this.world.time,index};
    }
    const reference = sample.type === 'scrape' ? SCRAPE_REFERENCE_FORCE : this.referenceForce;
    // High clicks expand the display range; a matched mat test uses one gain for both runs.
    const force = sample.heightDrop && sample.force > reference
      ? sample.force**2/reference : sample.force*(sample.matGain ?? 1);
    const index = limitScrapeIndex(sample.type,thumpIndex(force,reference));
    return {...sample,kind:'live',start,time:this.world.time,index};
  }

  #publishThump(peak,received,start) {
    this.emit('thump',this.#reportThump(peak,start));
    if (!received) return;
    const event = this.#reportThump(received,start);
    if (event.action === 'dropBall' && (event.index > (this.bestDrop?.index ?? -1) ||
        (event.index === this.bestDrop?.index && event.dropY < this.bestDrop.y))) {
      this.bestDrop = {index:event.index,y:event.dropY};
    }
    this.pendingDrops.delete(event.actionId);
    const sixChair = this.rooms.get(6).props.chair;
    const history = event.slab === '6/7' && event.sourceRoom === 7 && event.action !== 'matDrop' ? this.recordings.upper
      : event.slab === '6/5' && event.bodyId === sixChair.id ? this.recordings.chair : null;
    if (history) {
      history.push(structuredClone(event));
      if (history.length > 96) history.shift();
    }
    this.deliver(event);
  }

  step(dt = this.dt) {
    if (dt !== this.dt) throw new RangeError('Building uses its configured fixed timestep');
    const target = this.sensor ? this.angle : angleForProgress(this.progress), limit = MAX_ANGULAR_SPEED*dt;
    const delta = target-this.angle;
    if (delta) {
      this.angle = Math.abs(delta) <= limit+EPS ? target : this.angle+Math.sign(delta)*limit;
      const x = Math.sin(this.angle)*GRAVITY, y = Math.cos(this.angle)*GRAVITY;
      this.world.gravity(Math.abs(x) < EPS ? 0 : x,Math.abs(y) < EPS ? 0 : y);
      if (!this.copyReleased) this.#setCopyReleased(true);
      this.returnPoseReady = false;
    }
    if (!this.copyReleased) for (const body of this.copyBlocks) this.world.sleepBody(body);

    const drag = this.chairDrag?.settled ? undefined : this.chairDrag;
    const preset = drag?.link && drag.preset;
    if (preset) {
      preset.step++;
      if (preset.step <= preset.travelSteps) this.#steerChair(preset.x+preset.distance*preset.step/preset.travelSteps);
    }
    const pointer = drag?.link && drag.pointer;
    if (pointer) {
      const tick = this.world.tick+1;
      while (pointer.samples[0]?.tick <= tick) this.#steerChair(pointer.samples.shift().x);
    }
    if (drag?.link) drag.targetDistance = Math.max(drag.targetDistance,Math.abs(drag.link.anchorB.x-drag.startX));
    this.contacts.length = 0;
    stepMatWorld(this.world,dt,this.mat,this.rooms.get(7).props.ball);
    if (this.listening) this.#dampListeningRoll();
    if (drag) {
      const chair = this.rooms.get(7).props.chair;
      if (drag.link) drag.distance += Math.abs(chair.x-drag.lastX);
      drag.lastX = chair.x;
      drag.settled = !drag.link && chair.sleeping;
    }
    const touching = slabPairs(this.world.contacts,this.slabByBody,this.activeDrop,drag);
    const complete = this.windows.advance(this.world.time,touching,this.contacts);
    for (const contact of this.contacts) this.emit('contact',contact);
    for (const {start,peak,received} of complete) {
      if (peak.action === 'dragChair') {
        if (drag?.link && drag.actionId === peak.actionId && received &&
            received.force > (drag.peak?.force ?? 0)) drag.peak = received;
        continue;
      }
      this.#publishThump(peak,received,start);
    }
    if (this.chairDrag === drag && ((preset && preset.step === preset.totalSteps) ||
        (pointer && pointer.releaseTick <= this.world.tick))) this.#releaseChair();
    const drop = this.activeDrop;
    if (drop && !drop.landed && this.rooms.get(7).props.ball.sleeping) {
      // Furniture can roll into an otherwise clear column while the ball is falling.
      const thrown = drop.action === 'throwBall';
      if (thrown || drop.retried || !this.#releaseDrop(drop)) {
        this.activeDrop = undefined;
        this.#cancelDrop(drop,thrown ? 'rested' : 'blocked');
      } else drop.retried = true;
    }
    if (this.dropQueue.length && (!this.activeDrop || this.activeDrop.landed)) {
      const next = this.dropQueue.shift();
      if (!this.#releaseDrop(next)) this.#cancelDrop(next,'blocked');
    }
    this.#alignListeningChair();
    if (this.player) {
      this.player.step(dt);
      if (this.player?.done) this.player = undefined;
    }
    this.#stepLamps(dt);
    if (delta && this.angle === target && (target === 0 || target === 2*Math.PI)) this.#resetLamps();
    if (!this.returnPoseReady && this.angle === target && (target === 0 || target === 2*Math.PI)) {
      this.settleReturnedRooms();
    }
  }
}

export function createBuilding({dt=BUILDING_DT}={}) {
  return new Building(dt);
}
