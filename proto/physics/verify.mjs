import assert from 'node:assert/strict';
import { MATERIALS, World, bindDOM, contain, dragPointer, fixedLoop,
  orientationToGravity, requestOrientation, tiltGravity } from './engine.js';
import { playImpactTrack, recordImpacts, recordRun, replayRun } from './replay.js';
import { createRoom, exciteLamp, isSlabImpact, roomInput, WIDTH } from './room.js';
import { createBuilding, compareMatDrop, angleForProgress, MAX_ANGULAR_SPEED,
  MAX_THROW_SPEED, THUMP_WINDOW, thumpIndex } from './building.js';

const dt = 1/120;
function steps(world, count) {
  for (let i=0; i<count; i++) world.step(dt);
}

{
  const world = new World({gy:0,cell:3});
  const a = world.add({radius:10,x:-15,vx:100,restitution:1});
  const b = world.add({radius:10,x:15,vx:-100,restitution:1});
  steps(world,24);
  assert.ok(a.vx < -98 && b.vx > 98, 'circle collision resolves once across several cells');
  const square = world.add({fixed:true,width:20,height:20,x:80});
  const corner = world.add({radius:5,x:94,y:14});
  world.step(dt);
  assert.equal(world.contacts.size,0,'AABBs overlap but the corner misses the circle');
  world.move(corner,93,13);
  world.step(dt);
  assert.ok(corner.vx > 0 && corner.vy > 0,'corner response points away from the polygon');
  assert.ok(square.contains(80,0));
  assert.throws(() => world.add({vertices:[{x:0,y:0},{x:4,y:0},{x:1,y:1},{x:4,y:4},{x:0,y:4}]}));
  const triangle = world.add({vertices:[{x:0,y:0},{x:0,y:6},{x:9,y:0}],x:120,y:20});
  assert.ok(triangle.contains(120,20) && !triangle.contains(126,25),'clockwise input is centered and supported');
}

{
  const world = new World({gy:780,iterations:14});
  const floor = world.add({fixed:true,width:800,height:60,x:200,y:250,friction:0.9});
  const lower = world.add({width:50,height:30,x:110,y:160,friction:0.8});
  const upper = world.add({width:50,height:30,x:110,y:100,friction:0.8});
  steps(world,600);
  assert.ok(lower.sleeping && upper.sleeping,'two boxes settle and sleep together');
  assert.ok(Math.abs(lower.bottom-220) < 2 && Math.abs(upper.bottom-lower.top) < 2,'stack is stable');
  world.kick(lower,100,0);
  world.step(dt);
  assert.ok(!upper.sleeping,'kick wakes a contact island');
  steps(world,160);
  assert.ok(Math.abs(lower.vx) < 5,'friction slows sliding');
  world.remove(floor);
  steps(world,40);
  assert.ok(lower.y > 235 && !lower.sleeping,'removing a support wakes resting bodies');
  assert.ok(lower.pose(0).y < lower.pose(0.5).y && lower.pose(0.5).y < lower.pose().y);
}

{
  const world = new World({gy:500});
  const bob = world.add({radius:6,x:30});
  const rope = world.link(bob,null,{anchorB:{x:0,y:0},length:50,rope:true});
  world.step(dt);
  assert.equal(bob.vx,0,'slack rope does not push');
  steps(world,360);
  assert.ok(Math.hypot(bob.x,bob.y) < 51,'taut rope limits extension');
  world.unlink(rope);
  const spring = world.link(bob,null,{anchorB:{x:0,y:0},length:25,frequency:4});
  steps(world,360);
  assert.ok(Math.abs(Math.hypot(bob.x,bob.y)-25) < 2,'damped spring settles with gravity');
  world.remove(bob);
  assert.ok(!world.links.includes(spring),'removing a body also removes its links');
}

{
  const world = new World({gy:0,cell:3});
  const a = world.add({radius:10,x:-10,vx:100,restitution:1});
  const b = world.add({radius:10,x:10,vx:-100,restitution:1});
  const impacts = [];
  const unsubscribe = world.onImpact(event => impacts.push(event));
  world.step(dt);
  unsubscribe();
  assert.equal(impacts.length,1,'one contact event, independent of solver iterations and hash cells');
  const [hit] = impacts;
  assert.equal(hit.a,a);
  assert.equal(hit.b,b);
  assert.deepEqual(hit.point,{x:0,y:0});
  assert.equal(hit.impulse,200,'reports the solved impulse in mass·px/s');
  assert.equal(hit.tick,1);
  assert.equal(hit.dt,dt);
  assert.deepEqual(hit.gravity,{x:0,y:0});
  world.move(a,-10,0);
  world.move(b,10,0);
  a.vx = 100;
  b.vx = -100;
  world.step(dt);
  assert.equal(impacts.length,1,'unsubscribe removes the observer');
}

{
  const world = new World({gx:0,gy:600});
  const body = world.add({radius:8,material:'chairCover',friction:0.3});
  assert.equal(body.friction,0.3);
  assert.equal(body.damping,MATERIALS.chairCover.damping);
  world.setMaterial(body,'slipper');
  assert.equal(body.restitution,MATERIALS.slipper.restitution);
  world.gravityTo({x:400,y:-600},600);
  steps(world,18);
  assert.ok(world.gx > 0 && world.gx < 100 && world.gy > 0);
  steps(world,18);
  assert.ok(Math.abs(world.gx-200) < 1e-9 && Math.abs(world.gy) < 1e-9);
  steps(world,36);
  assert.equal(world.gx,400);
  assert.equal(world.gy,-600);
  world.gravityTo({x:0,y:600},600);
  steps(world,24);
  const before = world.gy;
  world.gravityTo({x:0,y:-900},300);
  assert.equal(world.gy,before,'restarting a transition begins at the current value');
  steps(world,36);
  assert.equal(world.gy,-900);
  world.gravityTo({x:0,y:600},600);
  world.gravity(0,0);
  steps(world,120);
  assert.equal(world.gy,0,'an instant setter cancels the pending transition');
}

function walkAndMeasure(mat) {
  const room = createRoom();
  const track = recordImpacts(room.world,{filter:event => isSlabImpact(room,event),limit:1});
  room.world.onImpact(event => {
    if (isSlabImpact(room,event)) exciteLamp(room,event);
  });
  roomInput(room,{type:'mat',enabled:mat});
  roomInput(room,{type:'walk',x:WIDTH/2});
  let peak = 0;
  for (let i=0;i<240;i++) {
    room.world.step(dt);
    room.lower.step(dt);
    peak = Math.max(peak,Math.abs(room.lamp.x-WIDTH/2));
    assert.ok(room.world.bodies.length+room.lower.bodies.length <= 40);
  }
  const [impact] = track.snapshot();
  assert.ok(impact && impact.tick <= 12,'walking produces a real slab hit promptly');
  assert.ok(peak > 1,'the moving ceiling support drives the suspended lamp');
  track.stop();
  return {impulse:impact.impulse,peak};
}

{
  const hard = walkAndMeasure(false), soft = walkAndMeasure(true);
  assert.ok(soft.impulse < hard.impulse && soft.peak < hard.peak,'mat reduces the hit and lamp motion');
  const room = createRoom();
  const originalY = room.ball.y;
  const apply = (_,value) => roomInput(room,value);
  const filter = event => isSlabImpact(room,event);
  const run = recordRun(room.world,{apply,filter,dt});
  const advance = count => { for (let i=0;i<count;i++) run.step(); };
  run.input({type:'walk',x:230});
  advance(15);
  run.input({type:'mat',enabled:true});
  run.input({type:'walk',x:230});
  advance(15);
  run.input({type:'grab',x:room.chair.x,y:room.chair.y});
  run.input({type:'drag',x:room.chair.x+63,y:room.chair.y});
  advance(25);
  run.input({type:'release'});
  assert.ok(room.chair.x > 178,'the drag constraint moves the chair');
  run.input({type:'flip',up:true});
  advance(190);
  assert.ok(room.ball.y < originalY-100 && room.world.gy < 0,'reversal moves bodies toward the ceiling');
  const tape = JSON.parse(JSON.stringify(run.stop()));
  assert.ok(tape.impacts.length >= 4);
  const fresh = createRoom();
  assert.deepEqual(
    replayRun(fresh.world,tape,{apply:(_,value) => roomInput(fresh,value),filter:event => isSlabImpact(fresh,event)}),
    tape,'identical tick-indexed input reproduces the same contact stream'
  );
  const played = [];
  const player = playImpactTrack(tape.impacts,event => played.push(event));
  for (let i=0;i<tape.steps;i++) player.step(dt);
  assert.ok(player.done);
  assert.deepEqual(played,tape.impacts,'timed playback preserves all recorded points and impulses');
}

function launchSix(building,{y,vy=0}={}) {
  const room = building.rooms.get(6), cup = room.props.cup;
  cup.vx = cup.spin = 0;
  cup.vy = vy;
  building.world.move(cup,84,y ?? (room.top+room.bottom)/2,0);
  return cup;
}

{
  const measured = compareMatDrop();
  assert.deepEqual(compareMatDrop(),measured,'the matched drop experiment is deterministic');
  assert.equal(measured.bare.index,100);
  assert.equal(measured.padded.index,56);
  assert.ok(measured.reduction >= 30 && measured.reduction <= 70);
  assert.ok(measured.padded.mat && measured.padded.force < measured.bare.force);

  const building = createBuilding();
  const received = [], raw = [];
  building.onReceive(event => received.push(event));
  building.onContact(event => raw.push(event));
  const ball = building.rooms.get(7).props.ball;
  const starts = [];
  for (const enabled of [false,true]) {
    assert.ok(building.input({type:'mat',enabled}));
    assert.ok(building.input({type:'matDrop'}));
    starts.push([ball.x,ball.y,ball.vx,ball.vy,ball.inv]);
    steps(building,150);
  }
  assert.deepEqual(starts[0],starts[1]);
  assert.equal(starts[0][0],building.mat.x,'both comparisons use the center of the mat');
  const [bare,padded] = [1,2].map(id => received.find(event => event.actionId === id));
  assert.equal(bare.bodyId,ball.id);
  assert.equal(padded.bodyId,ball.id);
  assert.equal(padded.slab,'6/7');
  assert.equal(bare.force,measured.bare.force);
  assert.equal(padded.force,measured.padded.force);
  assert.equal(building.recording('upper').length,0,'S5 does not change the S1/S2 tape');
  const compressedSteps = raw.filter(event => event.actionId === 2 && event.mat &&
    event.normalImpulse > 2*building.world.gy*event.dt);
  assert.ok(new Set(compressedSteps.map(event => event.time)).size > 1,'the mat spreads its load across steps');
  assert.ok(building.input({type:'mat',enabled:false}));
  assert.equal(building.mat,undefined);
}

{
  let previous;
  for (let y=26;y<=91;y+=0.5) {
    const measured = compareMatDrop({y});
    if (previous) {
      assert.ok(measured.bare.index <= previous.bare.index);
      assert.ok(Math.abs(measured.reduction-previous.reduction) < 1.1,'the half-pixel sweep has no large phase jumps');
    }
    previous = measured;
  }
}

{
  function dragTrace() {
    const building = createBuilding(), chair = building.rooms.get(7).props.chair;
    const start = chair.x;
    const frictionByTick = new Map();
    building.onContact(event => {
      if (!event.scrape || event.slipSpeed < 6) return;
      frictionByTick.set(event.tick,(frictionByTick.get(event.tick) ?? 0)+Math.abs(event.tangentImpulse));
    });
    assert.ok(building.input({type:'grabChair',x:start+10}));
    for (let i=1;i<=12;i++) {
      assert.ok(building.input({type:'dragChair',x:start+10-i*5}));
      steps(building,8);
    }
    assert.ok(!building.recording('upper').some(event => event.action === 'dragChair'));
    assert.ok(start-chair.x > 30 && building.chairDragDistance+1e-9 >= start-chair.x);
    assert.ok(building.input({type:'releaseChair'}));
    steps(building,180);
    assert.ok(Math.abs(chair.angle) < 0.1);
    const events = building.recording('upper').filter(event => event.action === 'dragChair');
    assert.equal(events.length,1,'one gesture produces exactly one recorded scrape');
    const [event] = events;
    assert.equal(event.label,'드르륵');
    assert.equal(event.type,'scrape');
    assert.equal(event.face,'top');
    assert.equal(event.receiverRoom,6);
    assert.equal(event.dragDistance,building.chairDragDistance);
    assert.equal(event.frictionImpulse,Math.max(...frictionByTick.values()));
    return events;
  }
  assert.deepEqual(dragTrace(),dragTrace());
}

{
  function dragPreset(distance,mode,{travelFrames=60,holdFrames=18}={}) {
    const building = createBuilding();
    const chair = building.rooms.get(7).props.chair;
    const start = chair.x, frames = travelFrames+holdFrames;
    const heard = [], reported = [];
    building.onReceive(event => { if (event.action === 'dragChair') heard.push(event); });
    building.onThump(event => { if (event.action === 'dragChair') reported.push(event); });
    if (mode === 'pointer') {
      assert.ok(building.input({type:'grabChair',x:start}));
      assert.equal(building.settleChairDrag(),false,'keep a real pointer drag active');
      for (let i=1;i<=travelFrames;i++) {
        assert.ok(building.input({type:'dragChair',x:start+distance*i/travelFrames}));
        building.step();
      }
      steps(building,frames-travelFrames);
      assert.ok(building.input({type:'releaseChair'}));
    } else {
      assert.ok(building.input({type:'dragChair',distance}));
      if (mode === 'reduced') {
        steps(building,21);
        let remainingSteps = 0;
        assert.ok(building.settleChairDrag(() => { building.step(); remainingSteps++; }));
        assert.equal(remainingSteps,frames-21);
      } else if (mode === 'reducedImmediate') {
        assert.ok(building.settleChairDrag());
      } else {
        steps(building,frames-1);
        assert.equal(heard.length,0);
        building.step();
      }
    }
    assert.equal(building.settleChairDrag(),false);
    assert.equal(building.input({type:'releaseChair'}),false,'there is no second settlement');
    const [scrape] = building.recording('upper').filter(event => event.action === 'dragChair');
    assert.equal(scrape.label,'드르륵');
    assert.ok(scrape.dragDistance > 0);
    assert.equal(scrape.dragTargetDistance,Math.abs(distance));
    assert.deepEqual(heard,[scrape]);
    assert.deepEqual(reported,[scrape]);

    assert.ok(building.replay('upper',[scrape]));
    building.step();
    assert.equal(heard.at(-1).kind,'replay');
    assert.equal(heard.at(-1).index,scrape.index);
    const legacy = {...scrape,index:470};
    assert.ok(building.replay('upper',[legacy]));
    building.step();
    const replay = heard.at(-1);
    assert.equal(replay.kind,'replay');
    assert.equal(replay.index,200);
    assert.equal(replay.force,legacy.force);
    return scrape;
  }

  for (const distance of [-10,-55]) {
    const animated = dragPreset(distance,'animated');
    for (const mode of ['pointer','reduced','reducedImmediate']) {
      assert.deepEqual(dragPreset(distance,mode),animated,'identical fixed input path produces identical records');
    }
    if (distance === -55) {
      assert.ok(animated.force > 1600,'the measured peak is preserved');
      assert.ok(Math.abs(animated.index-141) <= 12,'the default push lands near the 6F chair');
    } else {
      assert.ok(animated.index >= 40 && animated.index <= 70,'a short drag remains below the default');
    }
  }

  const slow = dragPreset(-200,'pointer',{travelFrames:360});
  const fast = dragPreset(-200,'pointer',{travelFrames:240});
  assert.ok(slow.dragDistance > 160 && fast.dragDistance > 160,'both sweeps travel far');
  assert.ok(slow.index < fast.index);
  assert.equal(fast.index,200);
  assert.deepEqual(dragPreset(-200,'pointer',{travelFrames:240}),fast);

  for (const distance of [-10,-55]) {
    const building = createBuilding();
    building.world.kick(building.rooms.get(7).props.ball,24,0);
    steps(building,180);
    assert.ok(building.input({type:'dragChair',distance}));
    assert.ok(building.settleChairDrag());
    const scrape = building.recording('upper').find(event => event.action === 'dragChair');
    assert.ok(distance === -10 ? scrape.index >= 40 && scrape.index <= 70 : Math.abs(scrape.index-141) <= 12);
  }
}

{
  const building = createBuilding(), ball = building.rooms.get(7).props.ball;
  const tape = [];
  building.onReceive(event => { if (event.action === 'matDrop') tape.push(event); });
  building.input({type:'dropBall',x:100,y:68});
  steps(building,150);
  assert.equal(building.bestDrop.y,68);
  building.input({type:'matDrop'});
  assert.equal(ball.y,68);
  steps(building,150);
  building.input({type:'dropBall',x:100,y:26});
  steps(building,150);
  assert.equal(building.bestDrop.y,26);
  building.input({type:'mat',enabled:true});
  building.input({type:'matDrop'});
  assert.equal(ball.y,68,'a later personal record does not change the matching padded trial');
  steps(building,150);
  const [bare,padded] = [2,4].map(id => tape.find(event => event.actionId === id));
  const benchmark = compareMatDrop({y:68});
  assert.equal(bare.force,benchmark.bare.force);
  assert.equal(padded.force,benchmark.padded.force);
  assert.equal(bare.index,benchmark.bare.index);
  assert.equal(padded.index,benchmark.padded.index);
}

{
  const building = createBuilding(), room = building.rooms.get(6);
  const impacts = [];
  building.onReceive(event => { if (event.action === 'matDrop') impacts.push(event); });
  building.input({type:'dropBall',x:120,y:26});
  steps(building,360);
  building.setProgress(0.65);
  steps(building,390);
  building.setProgress(0.95);
  steps(building,390);
  building.resetCopyBlocks();
  assert.ok(building.input({type:'matDrop'}));
  assert.equal(building.rooms.get(7).props.ball.y,26);
  assert.equal(building.rooms.get(7).props.ball.x,building.width/2,'the highest S5 trial also drops at the center');
  let peak = 0;
  for (let i=0;i<360;i++) {
    building.step();
    const anchor = building.lampWorld.linkAnchor(room.cable);
    peak = Math.max(peak,Math.abs(Math.atan2(room.lamp.x-anchor.x,room.lamp.y-anchor.y)));
  }
  assert.ok(peak >= 0.25 && peak < 0.6,'the tallest bare drop stays under the pendant limit');
  assert.ok(building.input({type:'mat',enabled:true}));
  assert.ok(building.input({type:'matDrop'}));
  assert.equal(building.rooms.get(7).props.ball.x,building.mat.x);
  steps(building,180);
  const firstImpacts = [false,true].map(surface => impacts.find(event => event.mat === surface));
  assert.deepEqual(firstImpacts.map(({point,index}) => [Math.round(point.x),index]),[[240,200],[240,114]]);
}

{
  const building = createBuilding(), ball = building.rooms.get(7).props.ball;
  assert.ok(building.input({type:'throwBall',x:120,y:91,vx:300,vy:400}));
  assert.deepEqual([ball.vx,ball.vy],[300,400]);
  steps(building,180);
  assert.ok(building.input({type:'throwBall',x:120,y:91,vx:600,vy:800}));
  assert.ok(Math.abs(Math.hypot(ball.vx,ball.vy)-MAX_THROW_SPEED) < 1e-9);
  assert.ok(Math.abs(ball.vx/ball.vy-0.75) < 1e-9,'the cap preserves direction');
  steps(building,180);
  const impacts = building.recording('upper').filter(event => event.action === 'throwBall');
  assert.ok(impacts.some(event => event.actionId === 1 && event.index > 100));
  assert.ok(impacts.some(event => event.actionId === 2 && event.receiverRoom === 6));
}

{
  const building = createBuilding(), ball = building.rooms.get(7).props.ball;
  assert.ok(building.input({type:'throwBall',x:375,y:85,vx:-600,vy:0}));
  assert.equal(ball.x,375,'the chair below does not shift a valid throw release');
  steps(building,240);
  assert.ok(building.input({type:'throwBall',x:233,y:85,vx:Number.MAX_VALUE,vy:Number.MAX_VALUE}));
  assert.ok(Math.abs(Math.hypot(ball.vx,ball.vy)-MAX_THROW_SPEED) < 1e-9);
}

for (const inverted of [false,true]) {
  const building = createBuilding(), raw = [], transmitted = [];
  const sensor = (beta,gamma,angle=0) => orientationToGravity({beta,gamma},{angle,strength:920});
  building.onContact(hit => raw.push(hit));
  building.onReceive(hit => transmitted.push(hit));
  building.setProgress(0.2);
  assert.ok(building.setSensorGravity(sensor(inverted ? -90 : 90,0),{listening:inverted}));
  building.setProgress(0.6);
  assert.equal(building.listening,inverted);
  for (const command of [{type:'tap'},{type:'throwBall',vx:0,vy:-600},{type:'grabChair',x:300}]) {
    assert.equal(building.input(command),false);
  }
  const room = building.rooms.get(6), ceiling = inverted ? '6/5' : '6/7';
  const cup = launchSix(building,{y:inverted ? room.bottom-38 : room.top+38,vy:inverted ? 460 : -460});
  for (let i=0;i<46;i++) {
    const pitch = i%2 ? 65 : 84, roll = i%2 ? 36 : -36;
    const sample = sensor(pitch,roll);
    assert.ok(building.setSensorGravity(sample));
    building.step();
    assert.equal(building.angle,0,'sensor tilt leaves the building drawing upright');
    assert.ok(Math.hypot(building.world.gx,building.world.gy) <= 920+1e-8);
    if (inverted) assert.equal(building.world.gy,-920,'confirmed inversion keeps gravity fixed while shaking');
  }
  assert.ok(raw.some(event => event.body === cup && event.slab.id === ceiling &&
    event.face === 'bottom' && event.closingSpeed > 200));
  assert.ok(!transmitted.some(event => event.bodyId === cup.id && event.slab === ceiling));
  assert.ok(building.clearSensorGravity());
  assert.equal(building.world.gy,920);
  assert.ok(Math.abs(sensor(90,0,90).x-920) < 1e-8);
  assert.ok(Math.abs(sensor(90,0,180).y+920) < 1e-8);
}

{
  const building = createBuilding(), raw = [], transmitted = [];
  const ball = building.rooms.get(7).props.ball;
  assert.ok(building.input({type:'mat',enabled:true}));
  assert.ok(building.setSensorGravity({x:0,y:-920},{listening:true}));
  building.onContact(event => raw.push(event));
  building.onReceive(event => transmitted.push(event));
  building.world.move(ball,building.mat.x,building.mat.top-44);
  building.world.kick(ball,0,460);
  steps(building,50);
  assert.ok(raw.some(event => event.body === ball && event.mat && event.face === 'bottom'));
  assert.ok(!transmitted.some(event => event.bodyId === ball.id && event.slab === '6/7'));
}

{
  const building = createBuilding();
  const {ball,chair,cup} = building.rooms.get(7).props;
  const mug = building.rooms.get(6).props.cup;
  assert.deepEqual([ball.x,chair.x,cup.x],[310,375,440]);
  for (const body of [cup,mug]) {
    assert.equal(body.right-body.left,14);
    assert.equal(body.bottom-body.top,18);
  }
  assert.ok(Math.abs(1/cup.inv-0.168) < 1e-9);
  assert.ok(Math.abs(1/mug.inv-0.5*14*18/(24*31)) < 1e-9);
  building.world.kick(ball,24,0);
  steps(building,600);
  assert.ok(ball.sleeping && ball.x > 310 && ball.x < chair.x && chair.x < cup.x);
  assert.ok(Math.abs(chair.left-ball.right) < 1,'the opening roll stops beside the chair');
}

for (const tap of [false,true]) {
  for (const [initialMotion, overCup] of [[false,false],[false,true],[true,false],[true,true]]) {
    const building = createBuilding(), room = building.rooms.get(7);
    const {ball,chair,cup} = room.props;
    const impacts = [];
    if (initialMotion) {
      building.world.kick(ball,24,0);
      steps(building,600);
    }
    assert.ok(ball.sleeping && ball.inv > 0,'the initial ball is a sleeping dynamic body');
    if (tap && initialMotion) building.world.kick(ball,25,-15,2);
    building.onReceive(event => { if (event.bodyId === ball.id) impacts.push(event); });
    const x = overCup ? cup.x : 1491/1877*building.width;
    assert.ok(building.input({type:'dropBall',x}));
    // The site tap adapter shortens the drop at the position selected by dropBall.
    if (tap) building.world.move(ball,ball.x,room.bottom-ball.shape.radius-12,0);
    assert.notEqual(ball.x,x,'blocked click snaps to an open column');
    assert.ok([chair,cup].every(body => ball.right < body.left || ball.left > body.right),
      'the chosen column clears both the chair and cup');
    assert.equal(ball.sleeping,false,'a new drop wakes the ball');
    assert.deepEqual([ball.vx,ball.vy,ball.spin],[0,0,0],'a new drop resets prior velocities');
    const height = ball.y, start = building.world.time;
    assert.equal(ball.pose(0).y,height,'the interpolation origin also moves at release');
    building.step();
    assert.ok(ball.y > height && ball.vy > 0,'fall starts on the next physics step');
    steps(building,119);
    const [first] = impacts;
    assert.ok(first && first.time-start < 1 && first.slab === '6/7');
    assert.equal(first.receiverRoom,6);
    assert.equal(first.index,tap ? 43 : 100);
  }
}

for (const screenX of [700,928,1006]) {
  const building = createBuilding(), {ball} = building.rooms.get(7).props;
  const copy = building.copyBlocks[1], home = copy.pose();
  building.world.kick(ball,24,0);
  steps(building,180);
  const x = screenX/1440*building.width;
  assert.ok(x > copy.left-ball.shape.radius && x < copy.right+ball.shape.radius);
  assert.ok(building.input({type:'dropBall',x,y:26}));
  assert.equal(ball.x,x,'the unreleased copy does not redirect the high drop');
  steps(building,180);
  const [hit] = building.recording('upper');
  assert.ok(Math.abs(hit.point.x-x) < 1e-9,'the falling ball reaches the same column');
  assert.equal(hit.index,200);
  assert.deepEqual(copy.pose(),home,'the falling ball leaves the hidden copy at rest');
  const replayed = [];
  building.onReceive(event => { if (event.kind === 'replay') replayed.push(event); });
  assert.ok(building.replay('upper'));
  building.step();
  assert.deepEqual([replayed[0].point.x,replayed[0].index],[hit.point.x,hit.index]);
}

{
  const values = [];
  for (const y of [170,144,130,114,91,68,50,26]) {
    const building = createBuilding();
    assert.ok(building.input({type:'dropBall',x:120,y}));
    const ball = building.rooms.get(7).props.ball;
    assert.equal(ball.y,Math.min(y,150.5),'coordinate is the ball center, bounded by the room');
    steps(building,120);
    const [hit] = building.recording('upper');
    assert.ok(Math.abs(hit.point.x-120) < 1e-9);
    assert.equal(hit.actionId,1);
    values.push(hit.index);
  }
  assert.deepEqual(values,[30,43,65,80,100,133,165,200]);
  const building = createBuilding();
  assert.ok(building.input({type:'tap',x:120,y:26}));
  steps(building,120);
  assert.equal(building.recording('upper')[0].index,43,'floor tap keeps its short fall');
}

{
  const building = createBuilding(), {ball} = building.rooms.get(7).props;
  const advance = count => {
    for (let i=0;i<count;i++) {
      building.step();
      boundedLampPeak(building);
    }
  };
  building.world.kick(ball,24,0);
  advance(8);
  assert.ok(ball.vx > 0,'test begins during the opening roll');
  const accepted = [];
  for (let i=0;i<6;i++) {
    const allowed = building.canInputFor('dropBall');
    assert.equal(building.input({type:'dropBall',x:100+i*20,y:26+i*19}),allowed);
    if (allowed) accepted.push(i);
    assert.ok(building.dropQueue.length <= 1);
    advance(18);
  }
  assert.ok(accepted.length >= 2 && accepted.length < 6,'the second drop waits and surplus input is rejected');
  assert.ok(building.hasPendingDrop,'accepted clicks can outlast their input burst');
  advance(480);
  const hits = new Map();
  for (const hit of building.recording('upper')) if (!hits.has(hit.actionId)) hits.set(hit.actionId,hit);
  assert.deepEqual([...hits.values()].map(hit => hit.index),accepted.map(i => [200,170,143,113,91,74][i]));
  assert.ok([...hits.values()].every(hit => hit.inputTime <= hit.peakTime));
  assert.equal(building.hasPendingDrop,false);
}

for (const reason of ['rotation','sensor']) {
  const building = createBuilding(), cancelled = [], received = [];
  building.onInputCancelled(event => cancelled.push(event));
  building.onReceive(event => { if (event.action === 'dropBall') received.push(event); });
  assert.ok(building.input({type:'dropBall',x:120,y:26}));
  assert.ok(building.input({type:'dropBall',x:120,y:26}));
  assert.equal(building.input({type:'dropBall',x:120,y:26}),false);
  for (let i=0;i<120 && building.activeDrop.actionId === 1;i++) building.step();
  assert.equal(building.activeDrop.actionId,2,'the queued ball starts while the first collision window is open');
  if (reason === 'rotation') building.setProgress(0.65);
  else assert.ok(building.setSensorGravity({x:0,y:-920},{listening:true}));
  steps(building,300);
  assert.deepEqual(cancelled.map(event=>[event.actionId,event.reason]),[[1,reason],[2,reason]]);
  assert.deepEqual(received,[]);
  assert.equal(building.hasPendingDrop,false);
}

{
  const building = createBuilding(), sample = {time:0,index:100,point:{x:240}};
  assert.equal(building.replay('upper',[sample,{...sample,time:NaN}]),false);
  assert.equal(building.replay('upper',[{...sample,index:NaN}]),false);
  assert.equal(building.replay('upper',[{...sample,point:{x:NaN}}]),false);
  assert.equal(building.player,undefined);
  assert.ok(building.canInputFor('dropBall'));
}

{
  const building = createBuilding(), room = building.rooms.get(7);
  const {ball,chair} = room.props;
  assert.ok(building.input({type:'dropBall',x:200,y:26}));
  assert.ok(building.input({type:'tap',x:100}));
  // Move the chair into the chosen column and let the ball come to rest on it.
  building.world.move(chair,200,chair.y);
  building.world.move(ball,200,chair.top-ball.shape.radius+0.001);
  building.sleepRoom(7);
  steps(building,240);
  assert.deepEqual([...new Set(building.recording('upper').map(hit => hit.actionId))],[1,2]);
  assert.equal(building.hasPendingDrop,false);
}

function lampAngle(building,roomId,alpha=1) {
  const {lamp,cable} = building.rooms.get(roomId);
  const anchor = building.lampWorld.linkAnchor(cable), position = lamp.pose(alpha);
  return Math.atan2(position.x-anchor.x,position.y-anchor.y);
}

function boundedLampPeak(building) {
  let peak = 0;
  for (const room of [6,5]) for (const alpha of [0,0.5,1]) {
    peak = Math.max(peak,Math.abs(lampAngle(building,room,alpha)));
  }
  assert.ok(peak <= 0.6,`pendulum exceeded its angle limit: ${peak}`);
  return peak;
}

for (const x of [15,240,465]) {
  const building = createBuilding();
  building.deliver({receiverRoom:6,index:100,point:{x}});
  let peak = 0;
  for (let i=0;i<240;i++) {
    building.step();
    peak = Math.max(peak,boundedLampPeak(building));
  }
  assert.ok(peak >= 0.25,'a 100-index pulse swings the actual pendulum by at least 0.25 rad');
}

{
  const building = createBuilding(), impulses = [];
  const pulseLink = building.lampWorld.pulseLink.bind(building.lampWorld);
  building.lampWorld.pulseLink = (cable,velocity) => {
    impulses.push({cable,velocity});
    pulseLink(cable,velocity);
  };
  building.deliver({receiverRoom:6,index:100,point:{x:120}});
  steps(building,6);
  building.deliver({receiverRoom:6,index:999,point:{x:360}});
  building.deliver({receiverRoom:6,index:120,point:{x:120}});
  building.deliver({receiverRoom:5,index:100,point:{x:120}});
  steps(building,30);
  const six = impulses.filter(pulse => pulse.cable === building.rooms.get(6).cable);
  assert.equal(six.length,1,'overlapping pulses are coalesced per lamp');
  assert.ok(six[0].velocity.x < 0,'the strongest pulse keeps its direction');
  assert.ok(Math.abs(Math.hypot(six[0].velocity.x,six[0].velocity.y)-1500) < 1e-9);
  assert.equal(impulses.filter(pulse => pulse.cable === building.rooms.get(5).cable).length,1);
}

{
  const building = createBuilding(), delivered = [];
  building.onReceive(event => delivered.push(event));
  const tape = Array.from({length:5},(_,index) => ({index:159,time:index*0.10,point:{x:240,y:176}}));
  assert.ok(building.replay('upper',tape));
  assert.ok(building.canInput && building.canInputFor('nudgeChair'));
  for (const type of ['dropBall','tap','mat']) assert.equal(building.input({type}),false);
  assert.ok(building.input({type:'nudgeChair'}));
  let peak = 0;
  for (let i=0;i<36;i++) {
    building.step();
    peak = Math.max(peak,boundedLampPeak(building));
  }
  const [chair] = delivered.filter(event => event.sourceRoom === 6 && event.receiverRoom === 5);
  assert.equal(chair?.type,'scrape');
  assert.ok(building.player,'the chair is recorded before upstairs playback finishes');
  for (let i=0;i<300;i++) {
    building.step();
    peak = Math.max(peak,boundedLampPeak(building));
  }
  assert.equal(delivered.filter(event => event.track === 'upper' && event.receiverRoom === 6).length,5);
  assert.ok(peak > 0.3,'a burst remains visibly animated');
}

for (const progress of [0,0.95]) {
  const building = createBuilding();
  const pulseBoth = () => {
    for (const receiverRoom of [6,5]) building.deliver({receiverRoom,index:999,point:{x:240}});
  };
  function assertLampsAtRest() {
    for (const room of [6,5]) {
      const {lamp,cable} = building.rooms.get(room);
      assert.equal(lampAngle(building,room),0);
      assert.equal(lampAngle(building,room,0),0);
      assert.deepEqual([lamp.vx,lamp.vy,lamp.spin],[0,0,0]);
      assert.equal(cable.support,undefined);
    }
  }
  building.setProgress(0.65);
  steps(building,390);
  pulseBoth();
  steps(building,22);
  assert.ok(Math.abs(lampAngle(building,6)) > 0.1);
  building.setProgress(progress);
  assertLampsAtRest();
  const target = angleForProgress(progress);
  for (let i=0;i<120 && building.angle!==target;i++) {
    if (i===30 || i===90) pulseBoth();
    building.step();
    boundedLampPeak(building);
  }
  assert.equal(building.angle,target);
  assertLampsAtRest();
  assert.ok(building.input({type:'dropBall',x:240,y:26}));
  for (let i=0;i<240;i++) {
    building.step();
    boundedLampPeak(building);
  }
}

for (const inverted of [false,true]) {
  const building = createBuilding();
  if (inverted) {
    building.setProgress(0.65);
    steps(building,390);
    assert.ok(building.rooms.get(7).bodies.every(body => body.sleeping),'7F settles before listening');
  }
  const contacts = [], deliveries = [];
  building.onContact(event => contacts.push(event));
  building.onReceive(event => deliveries.push(event));
  const cup = launchSix(building);
  steps(building,130);
  const delivered = deliveries.find(event => event.bodyId === cup.id);
  assert.equal(delivered?.slab,inverted ? '6/7' : '6/5','gravity chooses which slab is the floor');
  assert.equal(delivered.sourceRoom,6);
  assert.equal(delivered.receiverRoom,inverted ? 7 : 5);
  assert.equal(delivered.face,'top');
  assert.deepEqual(delivered.gravity,{x:0,y:inverted ? -920 : 920});
  assert.ok(contacts.some(event => event.body === cup && event.slab.id === delivered.slab &&
    event.face === 'top' && event.receiverRoom === delivered.receiverRoom));
}

for (const inverted of [false,true]) {
  const building = createBuilding(), contacts = [], thumps = [], deliveries = [];
  if (inverted) { building.setProgress(0.65); steps(building,390); }
  building.onContact(event => contacts.push(event));
  building.onThump(event => thumps.push(event));
  building.onReceive(event => deliveries.push(event));
  const room = building.rooms.get(6), ceiling = inverted ? '6/5' : '6/7';
  const cup = launchSix(building,{y:inverted ? room.bottom-38 : room.top+38,vy:inverted ? 450 : -450});
  steps(building,47);
  assert.ok(contacts.some(event => event.body === cup && event.slab.id === ceiling &&
    event.face === 'bottom' && event.receiverRoom === null),'ceiling strike is detected');
  assert.ok(thumps.some(event => event.bodyId === cup.id && event.slab === ceiling && event.face === 'bottom'));
  assert.equal(deliveries.filter(event => event.bodyId === cup.id && event.slab === ceiling).length,0,
    'a ceiling strike is never sent to another room');
}

{
  const building = createBuilding(), raw = [], delivered = [];
  building.onContact(e => raw.push(e));
  building.onReceive(e => delivered.push(e));
  assert.equal(building.copyBlocks.length,2);
  assert.equal(building.world.bodies.filter(b => b.inv).length+building.lampWorld.bodies.length,10);
  assert.ok(building.input({type:'dropBall'}));
  steps(building,240);
  const [reference] = building.recording('upper');
  assert.ok(Math.abs(reference.index-100) <= 1,'a true room drop matches its separately simulated reference');
  assert.ok(Math.abs(reference.time-reference.start-THUMP_WINDOW) < 1e-9);
  const normals = new Map();
  for (const event of raw) {
    if (event.body.id !== reference.bodyId || event.slab.id !== '6/7' ||
        event.time < reference.start-1e-9 || event.time >= reference.time-1e-9) continue;
    normals.set(event.tick,(normals.get(event.tick) ?? 0)+event.normalImpulse);
  }
  assert.equal(reference.force,Math.max(...normals.values())/dt);
  const count = building.recording('upper').length;
  steps(building,180);
  assert.equal(building.recording('upper').length,count,'a body resting on the slab cannot start repeated windows');
  assert.equal(thumpIndex(building.referenceForce*100,building.referenceForce),999);
  assert.equal(thumpIndex(0,building.referenceForce),0);

  const sixChair = building.rooms.get(6).props.chair, chairX = sixChair.x;
  assert.ok(building.input({type:'nudgeChair'}));
  assert.ok(Math.abs(sixChair.spin) <= 0.6);
  let chairAngle = 0;
  for (let i=0;i<240;i++) {
    building.step();
    chairAngle = Math.max(chairAngle,Math.abs(sixChair.angle));
  }
  assert.ok(sixChair.x-chairX > 20 && chairAngle < 0.1,'the chair slides and stays upright');
  const upper = JSON.parse(JSON.stringify(building.recording('upper')));
  const chair = JSON.parse(JSON.stringify(building.recording('chair')));
  assert.ok(upper.length && chair.length);
  assert.equal(chair[0].type,'scrape');
  assert.ok(chair[0].index >= 80 && chair[0].frictionImpulse > 0);
  assert.equal(chair[0].force,chair[0].frictionImpulse/dt);
  assert.equal(building.replay('chair',chair),false,'6F chair replay requires the flipped listening state');
  const signature = events => events.map(e => [e.point.x,e.index,e.normalImpulse]);
  assert.ok(building.replay('upper',upper));
  steps(building,400);
  const first = delivered.filter(e => e.kind === 'replay');
  assert.deepEqual(signature(first),signature(upper));
  assert.ok(first.every(e => e.slab === '6/7' && e.sourceRoom === 7 && e.receiverRoom === 6));
  const aired = delivered.length;
  assert.ok(building.replay('upper',upper));
  steps(building,400);
  const second = delivered.slice(aired).filter(e => e.kind === 'replay');
  assert.deepEqual(second.map(e => e.playbackTime),first.map(e => e.playbackTime));
  assert.deepEqual(signature(second),signature(first));

  building.setProgress(0.65);
  building.step();
  assert.ok(building.angle > 0 && building.angle <= MAX_ANGULAR_SPEED*dt+1e-12);
  assert.ok(building.world.gx > 0,'screen down projects into the rotating building frame');
  steps(building,390);
  assert.equal(building.angle,Math.PI);
  assert.ok(building.listening);
  const ball = building.rooms.get(7).props.ball;
  const x = ball.x;
  for (const type of ['dropBall','tap','nudgeChair','mat']) assert.equal(building.input({type,x:0,enabled:true}),false);
  assert.equal(ball.x,x,'listening mode blocks room commands');
  building.sleepRoom(7);
  assert.ok(building.rooms.get(7).bodies.every(body => body.sleeping));
  building.wakeRoom(7);
  assert.ok(building.rooms.get(7).bodies.every(body => !body.sleeping));
  assert.equal(building.replay('upper',upper),false);
  const beforeChair = delivered.length;
  assert.ok(building.replay('chair',chair));
  steps(building,400);
  const replayed = delivered.slice(beforeChair).filter(e => e.kind === 'replay');
  assert.deepEqual(signature(replayed),signature(chair));
  assert.ok(replayed.every(e => e.slab === '6/7' && e.sourceRoom === 6 && e.receiverRoom === 7 &&
    e.face === 'top' && e.gravity.y < 0 && e.type === 'scrape'));

  building.setProgress(0.95);
  steps(building,120);
  assert.equal(building.angle,2*Math.PI);
  assert.ok(building.canInput && !building.listening);
  building.setProgress(0.65);
  building.step();
  assert.ok(building.angle < 2*Math.PI && 2*Math.PI-building.angle <= MAX_ANGULAR_SPEED*dt+1e-12);
  assert.equal(angleForProgress(0.2),0);
  assert.equal(angleForProgress(0.75),Math.PI);
}

{
  const building = createBuilding(), cues = [];
  const chair = building.rooms.get(6).props.chair;
  building.world.move(chair,330,chair.y);
  assert.ok(building.input({type:'nudgeChair'}));
  steps(building,120);
  const [record] = building.recording('chair');
  building.onReceive(event => { if (event.cue === 's4-chair') cues.push(event); });
  assert.equal(building.replayChairCue(record),false,'the cue waits for the listening state');
  building.setProgress(0.65);
  steps(building,96);
  assert.ok(building.listening);
  assert.equal(building.angle,Math.PI);
  const start = building.world.time;
  assert.ok(building.replayChairCue(record));
  assert.equal(building.replayChairCue(record),false,'a pending cue cannot be queued twice');
  steps(building,71);
  assert.equal(cues.length,0);
  building.step();
  assert.equal(cues.length,1);
  const [hit] = cues;
  assert.ok(Math.abs(hit.time-start-0.6) < 1e-9);
  assert.deepEqual([hit.kind,hit.track,hit.label,hit.slab,hit.face,hit.sourceRoom,hit.receiverRoom],
    ['replay','chair','6층 의자','6/7','top',6,7]);
  assert.equal(hit.point.x,chair.x,'the cue follows the transformed chair at delivery');
  assert.notEqual(hit.point.x,record.point.x,'the earlier room recording supplies the magnitude only');
  assert.deepEqual([hit.index,hit.force,hit.normalImpulse,hit.frictionImpulse],
    [record.index,record.force,record.normalImpulse,record.frictionImpulse]);
  assert.deepEqual(hit.gravity,{x:0,y:-920});
  assert.equal(hit.point.y,building.slabs[1].y);
  assert.equal(building.replayChairCue(),false,'a delivered cue cannot fire again in the same listening interval');
  steps(building,120);
  assert.equal(cues.length,1);
  assert.deepEqual(building.recording('chair'),[record],'the visual cue does not append to the tape');

  building.setProgress(0.95);
  steps(building,120);
  building.setProgress(0.65);
  steps(building,120);
  assert.ok(building.replayChairCue(),'a new listening interval can use the stored scrape');
  steps(building,72);
  assert.equal(cues.length,2);
  assert.deepEqual([cues[1].point.x,cues[1].index],[chair.x,record.index]);
}

for (const sensor of [false,true]) {
  const building = createBuilding(), cues = [];
  const enter = () => {
    if (sensor) assert.ok(building.setSensorGravity({x:0,y:-920},{listening:true}));
    else {
      building.setProgress(0.65);
      steps(building,120);
    }
    assert.ok(building.listening);
  };
  building.onReceive(event => { if (event.cue === 's4-chair') cues.push(event); });
  enter();
  assert.ok(building.replayChairCue());
  steps(building,24);
  if (sensor) assert.ok(building.clearSensorGravity());
  else building.setProgress(0.95);
  steps(building,180);
  assert.equal(cues.length,0,'leaving the listening state cancels its pending cue');
  enter();
  assert.ok(building.replayChairCue());
  steps(building,12);
  building.stopReplay();
  assert.ok(building.replayChairCue(),'an explicit stop before delivery permits a fresh schedule');
  steps(building,71);
  assert.equal(cues.length,0);
  building.step();
  assert.equal(cues.length,1);
  assert.equal(cues[0].index,141);
  assert.equal(cues[0].point.x,building.rooms.get(6).props.chair.x);
  assert.equal(building.replayChairCue(),false);
}

for (const nudged of [false,true]) {
  let rotationReceives = 0;
  for (const duration of [0.8,1.44,2,8]) {
    const building = createBuilding(), chair = building.rooms.get(6).props.chair;
    const cues = [];
    let explanationVisible = false;
    building.onReceive(event => {
      if (event.kind === 'live' && building.angle < Math.PI && event.sourceRoom === 6 && event.receiverRoom === 7) rotationReceives++;
      if (event.cue === 's4-chair') {
        assert.ok(explanationVisible);
        assert.equal(event.point.x,chair.x);
        cues.push([event.label,event.index,event.point.x/building.width]);
      }
    });
    if (nudged) assert.ok(building.input({type:'nudgeChair'}));
    steps(building,310);
    const turnSteps = Math.round(duration/dt);
    for (let i=1;i<=turnSteps;i++) {
      building.setProgress(0.25+0.30*i/turnSteps);
      building.step();
    }
    building.setProgress(0.65);
    for (let i=0;i<120 && !building.listening;i++) building.step();
    assert.ok(building.listening);
    assert.equal(cues.length,0,'the physical turn never emits a marker cue');
    explanationVisible = true;
    assert.ok(building.replayChairCue());
    const start = chair.x;
    building.step();
    assert.ok(Math.abs(chair.x-start) < 1,'the chair approaches the marker without a snap');
    steps(building,70);
    assert.equal(cues.length,0);
    building.step();
    assert.deepEqual(cues,[['6층 의자',141,0.8]]);
    steps(building,24);
    assert.equal(chair.x/building.width,0.8);
  }
  assert.ok(rotationReceives > 0,'real early 6F-to-7F impacts still reach physical listeners');
}

{
  const building = createBuilding();
  const home = building.copyBlocks.map(body => body.pose());
  building.setProgress(0.65);
  steps(building,390);
  assert.ok(building.copyBlocks.every(body => body.collisionEnabled));
  assert.equal(building.resetCopyBlocks(),false);
  building.setProgress(0.95);
  steps(building,390);
  const otherBodies = building.world.bodies.filter(body => !building.copyBlocks.includes(body));
  const state = body => [body.pose(0),body.pose(1),body.vx,body.vy,body.spin,body.sleeping];
  const remaining = otherBodies.map(state);
  assert.notDeepEqual(building.copyBlocks.map(body => body.pose()),home);
  assert.ok(building.resetCopyBlocks());
  assert.ok(building.copyBlocks.every(body => body.collisionEnabled === false));
  assert.deepEqual(building.copyBlocks.map(body => body.pose(0)),home);
  assert.deepEqual(otherBodies.map(state),remaining,'copy reset preserves every other body');
  steps(building,120);
  assert.deepEqual(building.copyBlocks.map(body => body.pose()),home,'copies stay at home until another rotation');
}

{
  const building = createBuilding();
  building.input({type:'dropBall',x:120,y:26});
  steps(building,150);
  const tape = building.recording('upper');
  building.setProgress(0.65);
  steps(building,390);
  assert.equal(building.settleReturnedRooms(),false);
  building.setProgress(0.95);
  while (building.angle !== 2*Math.PI) building.step();
  const copies = building.copyBlocks.map(body => body.pose());
  const props = [...building.rooms.values()].flatMap(room => Object.values(room.props)
    .filter(body => !building.copyBlocks.includes(body)).map(body => ({room,body})));
  function assertFloorPoses() {
    for (const {room,body} of props) {
      assert.ok(Math.abs(body.bottom-room.bottom) < 0.01,'every prop is on its own room floor');
      assert.deepEqual([body.angle,body.vx,body.vy,body.spin],[0,0,0,0]);
    }
  }
  assertFloorPoses();
  const chair = building.rooms.get(6).props.chair, plant = building.rooms.get(5).props.plant;
  building.world.move(chair,26,chair.y-75,1);
  building.world.move(plant,plant.x,plant.y-90,Math.PI);
  building.world.sleepBody(chair);
  building.world.sleepBody(plant);
  assert.ok(building.settleReturnedRooms());
  assertFloorPoses();
  assert.deepEqual(building.copyBlocks.map(body => body.pose()),copies,'copy reset remains independent');
  assert.deepEqual(building.recording('upper').slice(0,tape.length),tape);
  assert.ok(building.input({type:'matDrop'}));
  assert.equal(building.rooms.get(7).props.ball.y,26,'restoring the rooms preserves the selected test height');
}

class Surface extends EventTarget {
  clientWidth = 220;
  clientHeight = 200;
  clientLeft = 1;
  clientTop = 2;
  style = {};
  getBoundingClientRect() { return {left:10,top:20}; }
  setPointerCapture(id) { this.captured = id; }
  hasPointerCapture(id) { return this.captured === id; }
  releasePointerCapture() { this.captured = undefined; }
}

let frame, intersect, resize;
const media = new EventTarget();
media.matches = false;
globalThis.document = new EventTarget();
globalThis.matchMedia = () => media;
globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
globalThis.cancelAnimationFrame = () => { frame = undefined; };
globalThis.IntersectionObserver = class {
  constructor(callback) { intersect = value => callback([{isIntersecting:value}]); }
  observe() {}
  disconnect() { intersect = undefined; }
};
globalThis.ResizeObserver = class {
  constructor(callback) { resize = callback; }
  observe() {}
  disconnect() { resize = undefined; }
};

function event(target,type,properties) {
  const e = new Event(type);
  for (const [key,value] of Object.entries(properties)) Object.defineProperty(e,key,{value});
  target.dispatchEvent(e);
}

{
  const world = new World({gy:0});
  const body = world.add({radius:10,x:150,y:90});
  const surface = new Surface();
  const uncontain = contain(world,surface);
  const binding = bindDOM(body,surface);
  binding.render(1);
  assert.match(surface.style.transform,/translate\(150px,90px\)/);
  surface.clientWidth = 120;
  resize();
  assert.equal(body.x,110,'resize updates walls and clamps a body back within the viewport');
  assert.equal(world.bodies.length,5,'resize replaces the previous walls');

  const stopDrag = dragPointer(world,surface);
  for (const pointerType of ['mouse','touch']) {
    world.move(body,60,90);
    body.vx = body.vy = body.spin = 0;
    event(surface,'pointerdown',{button:0,pointerId:1,pointerType,clientX:71,clientY:112,timeStamp:10});
    assert.equal(world.links.length,1);
    assert.ok(surface.hasPointerCapture(1));
    event(surface,'pointermove',{pointerId:1,clientX:105,clientY:112,timeStamp:30});
    steps(world,3);
    assert.ok(body.x > 60);
    event(surface,'pointerup',{pointerId:1,timeStamp:35});
    assert.equal(world.links.length,0);
    assert.ok(body.vx > 100,'a quick release throws the body');
  }
  stopDrag();
  binding.destroy();
  uncontain();
  assert.equal(world.bodies.length,1);
}

{
  const reducedStates = [];
  let count = 0, alpha;
  const loop = fixedLoop({step:() => count++},new Surface(),value => { alpha = value; },
    {dt:0.01,maxSteps:3,onReduced:value => reducedStates.push(value)});
  assert.equal(frame,undefined,'waits for intersection');
  intersect(true);
  frame(0);
  frame(25);
  assert.equal(count,2);
  assert.ok(Math.abs(alpha-0.5)<1e-5,'uses accumulated time for render interpolation');
  frame(1025);
  assert.equal(count,5,'caps steps per frame');
  intersect(false);
  assert.equal(frame,undefined,'pauses outside the viewport');
  intersect(true);
  frame(5000);
  assert.equal(count,5,'time outside the viewport is discarded');
  document.hidden = true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(frame,undefined,'pauses in a hidden tab');
  document.hidden = false;
  document.dispatchEvent(new Event('visibilitychange'));
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  assert.equal(frame,undefined,'reduced motion disables stepping');
  assert.deepEqual(reducedStates,[false,true]);
  media.matches = false;
  media.dispatchEvent(new Event('change'));
  loop.pause();
  assert.equal(frame,undefined);
  loop.resume();
  assert.ok(frame);
  loop.destroy();
  assert.equal(frame,undefined);
}

{
  const world = new World({gy:1000});
  globalThis.screen = {orientation:{angle:90}};
  globalThis.window = new EventTarget();
  window.isSecureContext = true;
  const failures = [];
  const tilt = tiltGravity(world,{threshold:0,onFailure:reason => failures.push(reason)});
  assert.equal(await tilt.start(),'unavailable');
  window.DeviceOrientationEvent = {requestPermission:async () => 'denied'};
  assert.equal(await tilt.start(),'denied');
  assert.deepEqual(failures,['unavailable','denied']);
  event(window,'deviceorientation',{beta:90,gamma:0});
  assert.equal(world.gx,0);
  assert.equal(orientationToGravity({beta:null,gamma:0}),null);
  assert.ok(orientationToGravity({beta:-90,gamma:0}).y < -990,'upside-down screen reverses gravity');
  let requested = false;
  window.DeviceOrientationEvent.requestPermission = async () => { requested = true; return 'granted'; };
  const permission = requestOrientation();
  assert.ok(requested,'iOS request starts synchronously in the caller gesture');
  assert.equal(await permission,'enabled');
  window.DeviceOrientationEvent.requestPermission = async () => 'granted';
  assert.equal(await tilt.start(),'enabled');
  event(window,'deviceorientation',{beta:90,gamma:0});
  assert.ok(world.gx > 0 && world.gy < 1000,'rotates gravity into landscape coordinates');
  tilt.stop();
  assert.equal(world.gy,1000);
  assert.equal(world.gx,0);

  let stalled;
  const failure = new Promise(resolve => { stalled = resolve; });
  const blocked = tiltGravity(world,{sampleTimeout:5,onFailure:stalled});
  assert.equal(await blocked.start(),'enabled');
  assert.equal(await failure,'no-sample','sensor loss makes the button fallback available');
}

console.log('물리·브라우저 어댑터 회귀 검사 통과 (Node 브라우저 모의 객체)');
