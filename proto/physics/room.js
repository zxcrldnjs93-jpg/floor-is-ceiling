import { World } from './engine.js';

export const WIDTH = 480;
export const FLOOR = 244;
export const HEIGHT = 382;
const DOWN = 920;
const WALL = 48;
const clampX = x => Math.max(12,Math.min(WIDTH-12,x));

export function createRoom() {
  const world = new World({gy:DOWN,cell:44,iterations:12});
  const floor = world.add({fixed:true,width:WIDTH,height:WALL,x:WIDTH/2,y:FLOOR+WALL/2,material:'hardFloor'});
  const ceiling = world.add({fixed:true,width:WIDTH,height:WALL,x:WIDTH/2,y:-WALL/2,material:'hardFloor'});
  for (const x of [-WALL/2,WIDTH+WALL/2]) {
    world.add({fixed:true,width:WALL,height:FLOOR+2*WALL,x,y:FLOOR/2});
  }
  const ball = world.add({radius:17,x:86,y:FLOOR-17,mass:0.7,restitution:0.32});
  const chair = world.add({width:59,height:79,x:166,y:FLOOR-39.5,mass:1.5,friction:0.31});
  const cup = world.add({vertices:[{x:-13,y:-17},{x:13,y:-17},{x:9,y:17},{x:-9,y:17}],
    x:306,y:FLOOR-18,mass:0.43,restitution:0.11});
  const book = world.add({width:58,height:15,x:386,y:FLOOR-7.5,mass:0.65,restitution:0.12});
  const lower = new World({gy:810});
  const lamp = lower.add({radius:14,x:WIDTH/2,y:FLOOR+93,mass:1.3});
  const cable = lower.link(lamp,null,{anchorB:{x:WIDTH/2,y:FLOOR+17},length:76});
  const room = {world,lower,floor,ceiling,ball,chair,cup,book,lamp,cable,mat:false,up:false};
  world.onImpact(({a,b}) => {
    if (room.foot && (a === room.foot || b === room.foot) &&
        (a === floor || b === floor || a === ceiling || b === ceiling)) {
      world.remove(room.foot);
      room.foot = undefined;
    }
  });
  return room;
}

export function isSlabImpact(room, event) {
  const {a,b,slipSpeed,closingSpeed,tangentImpulse} = event;
  const surface = a === room.floor || a === room.ceiling || b === room.floor || b === room.ceiling;
  return surface && (closingSpeed >= 45 || (slipSpeed >= 28 && Math.abs(tangentImpulse) >= 1.6));
}

export function exciteLamp(room, {point,impulse}) {
  const strength = Math.min(950,impulse);
  room.lower.pulseLink(room.cable,{
    x:(point.x <= WIDTH/2 ? 1 : -1)*strength,
    y:0.24*strength
  });
}

export function roomInput(room, command) {
  const {world,chair} = room;
  switch (command.type) {
    case 'walk': {
      if (room.foot) world.remove(room.foot);
      const side = room.up ? -1 : 1, y = room.up ? 19 : FLOOR-19;
      // Keep the first contact on the slab near the tap, when there is room.
      const options = [0,24,-24,48,-48,72,-72,96,-96];
      const requested = clampX(command.x);
      const x = options.map(dx => clampX(requested+dx)).find(candidate =>
        world.bodies.every(b => !b.inv || b.right < candidate-10 || b.left > candidate+10 ||
          b.bottom < y-19 || b.top > y+19)
      ) ?? requested;
      room.foot = world.add({radius:9,x,y,vy:side*420,mass:1.12,restitution:0.12});
      break;
    }
    case 'mat':
      room.mat = command.enabled;
      world.setMaterial(room.floor,room.mat ? 'mat' : 'hardFloor');
      break;
    case 'flip':
      room.up = command.up;
      world.gravityTo({x:0,y:room.up ? -DOWN : DOWN},620);
      break;
    case 'gravity':
      if (Math.abs(command.y) >= 120) room.up = command.y < 0;
      world.gravity(command.x,command.y);
      break;
    case 'grab':
      if (room.handle) world.unlink(room.handle);
      room.handle = world.link(chair,null,{
        anchorA:chair.local(command.x,command.y),anchorB:{x:command.x,y:command.y},
        length:0,frequency:7,maxForce:5500
      });
      break;
    case 'drag':
      if (room.handle) {
        room.handle.anchorB = {x:command.x,y:command.y};
        world.wake(chair);
      }
      break;
    case 'release':
      if (room.handle) world.unlink(room.handle);
      room.handle = undefined;
      break;
    case 'nudge':
      world.kick(chair,chair.x < WIDTH/2 ? 205 : -205,0,0.35);
      break;
    default:
      throw new RangeError('Unknown room input');
  }
}
