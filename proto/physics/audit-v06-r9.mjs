// Node reproduction of R9. The scene frame is executed against synthetic timestamps.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createBuilding, compareMatDrop, BUILDING_DT } from './building.js';
import { classifyBehavior } from '../fx/type.js';

const rates = [60,120,144];
const dt = BUILDING_DT;
const round = (n, places=3) => Number(n.toFixed(places));
const ball = building => building.rooms.get(7).props.ball;
const values = body => [body.x,body.y,body.angle,body.vx,body.vy,body.spin];
const advance = (building, count) => {
  for (let step=0;step<count;step++) {
    building.step();
    assert.ok([...building.world.bodies,...building.lampWorld.bodies].every(body => values(body).every(Number.isFinite)));
  }
};

const sceneSource = readFileSync(new URL('../../site/modules/scenes.js',import.meta.url),'utf8');
const frameSource = sceneSource.match(/  function frame\(now\) \{[\s\S]*?\n  \}(?=\n\n  function stopFrames)/)?.[0];
assert.ok(frameSource,'Update the audit if the site moves the frame function');
const tapSettleSeconds = Number(sceneSource.match(/^const ACTION_SECONDS = ([\d.]+);$/m)?.[1]);
assert.ok(Number.isFinite(tapSettleSeconds));

function driveFrames(building,hz,seconds,{step=()=>advance(building,1),commands=[]}={}) {
  const frame = runInNewContext(`let drawingFrame,lastTime,accumulator=0;
    const clamp = x => Math.max(0,Math.min(1,x)); ${frameSource}\nframe`,{
    building,step,autoNudge(){},render(){},shouldAdvance:()=>true,requestFrame(){}
  });
  let next = 0;
  for (let i=0;i<=Math.ceil(seconds*hz);i++) {
    const timestamp = i*1000/hz;
    while (commands[next]?.[0] <= timestamp) {
      const [timeMs,command] = commands[next++];
      if (command.type === 'pointerSample') assert.ok(building.pushPointerSample(timeMs,command.x));
      else assert.ok(building.input(command));
    }
    frame(timestamp);
  }
  assert.equal(next,commands.length);
}

function fixedInputTrace(hz) {
  const building = createBuilding(), received = [];
  const input = command => assert.ok(building.input(command));
  const actions = new Map([
    [0,() => building.world.kick(ball(building),24,0)],
    [30,() => input({type:'dropBall',x:310,y:26})],
    [180,() => input({type:'tap',x:120})],
    [350,() => input({type:'dragChair',distance:-55})],
    [510,() => input({type:'throwBall',x:201.6,y:48,vx:-290,vy:285})],
    [760,() => input({type:'nudgeChair'})],
    [910,() => assert.ok(building.replay('upper'))],
    [1560,() => building.setProgress(0.65)],
    [1690,() => assert.ok(building.replayChairCue())],
    [1920,() => building.setProgress(0.95)],
    [2130,() => assert.ok(building.resetCopyBlocks())],
    [2140,() => input({type:'matDrop',y:26})],
    [2360,() => { input({type:'mat',enabled:true}); input({type:'matDrop',y:26}); }]
  ]);
  const poses = [];
  building.onReceive(event => received.push(event));
  let count = 0;
  driveFrames(building,hz,23,{step() {
    if (count === 2600) return;
    actions.get(count)?.();
    advance(building,1);
    poses.push([building.angle,building.world.gx,building.world.gy,
      ...[...building.world.bodies,...building.lampWorld.bodies].map(body => [...values(body),body.sleeping])]);
    count++;
  }});
  assert.equal(count,2600);
  const hash = createHash('sha256').update(JSON.stringify({poses,received})).digest('hex');
  const firstByAction = new Map();
  for (const event of received) {
    if (event.kind === 'live' && event.actionId !== undefined && !firstByAction.has(event.actionId)) {
      firstByAction.set(event.actionId,[event.action,event.index]);
    }
  }
  return { hz, steps:count, hash, firstIndices:[...firstByAction.values()],
    chairCue:received.find(event => event.cue === 's4-chair')?.index };
}

function wallClockDrag(hz,{distance,travel,wiggle=0,timed=true}) {
  const building = createBuilding(), hits = [];
  const start = 190.3, x = building.rooms.get(7).props.chair.x;
  const commands = [[start,{type:'grabChair',x,timeMs:timed ? start : undefined}]];
  const move = timed ? 'pointerSample' : 'dragChair';
  for (let t=8;t<travel;t+=8) {
    commands.push([start+t,{type:move,x:x+distance*t/travel+wiggle*Math.sin(t/21)}]);
  }
  const end = start+travel+150;
  commands.push([start+travel,{type:move,x:x+distance}],[end,{type:'releaseChair',timeMs:timed ? end : undefined}]);
  building.onReceive(event => { if (event.action === 'dragChair') hits.push(event); });
  driveFrames(building,hz,4,{commands});
  assert.equal(hits.length,1);
  const [event] = hits;
  return { hz, index:event.index, peakForce:round(event.force), distance:round(event.dragDistance) };
}

function burst(count,interval,{turn=false}={}) {
  const building = createBuilding(), first = new Map(), cancelled = [];
  building.onReceive(event => {
    if (event.action === 'dropBall' && !first.has(event.actionId)) first.set(event.actionId,event);
  });
  building.onInputCancelled(event => cancelled.push(event));
  let accepted = 0, lastInput;
  for (let i=0;i<count;i++) {
    accepted += Number(building.input({type:'dropBall',x:120,y:26}));
    lastInput = building.world.time;
    if (i+1<count) advance(building,interval);
  }
  const queued = building.dropQueue.length;
  const recordedAtLastInput = first.size;
  if (turn) {
    building.setProgress(0.65);
    advance(building,360);
  } else {
    for (let i=0;i<30_000 && building.hasPendingDrop;i++) advance(building,1);
  }
  const last = [...first.values()].at(-1);
  assert.equal(first.size+cancelled.length,accepted,'each accepted input is recorded or explicitly cancelled');
  assert.ok(cancelled.every(event => !first.has(event.actionId)));
  return { count, intervalTicks:interval, turn, accepted, rejected:count-accepted, queued, recordedAtLastInput,
    cancelled:cancelled.length, cancellationReasons:[...new Set(cancelled.map(event=>event.reason))],
    received:first.size, tapeSize:building.recording('upper').length, pending:building.hasPendingDrop,
    lastImpactAfterLastInput:round(last.time-lastInput),
    ...(turn ? {} : { s2ReadyAfterLastInput:round(last.time+0.45-lastInput) }) };
}

function timingType(reduced) {
  const building = createBuilding(), events = [];
  building.onReceive(event => {
    if (event.action === 'tap') events.push({index:event.index,timeMs:event.inputTime*1000});
  });
  const pressTimesMs = Array.from({length:6},(_,i)=>i*150);
  let accepted = 0;
  for (const _ of pressTimesMs) {
    accepted += Number(building.input({type:'tap',x:120}));
    if (reduced) {
      for (let elapsed=0;elapsed<tapSettleSeconds;elapsed+=dt) advance(building,1);
    } else advance(building,18);
  }
  advance(building,360);
  const {title,stats} = classifyBehavior({events},{enableV11:true});
  return { reduced, accepted, pressTimesMs, eventTimesMs:events.map(event => round(event.timeMs-events[0].timeMs,1)),
    n:stats.n, burst:stats.burst, title };
}

function sleepingAndExtreme() {
  const building = createBuilding(), hits = [];
  const upper = building.rooms.get(7), chair = upper.props.chair;
  building.onReceive(event => { if (event.actionId !== undefined) hits.push(event); });
  building.world.kick(ball(building),24,0);
  advance(building,600);
  assert.ok(ball(building).sleeping);
  assert.ok(building.input({type:'dropBall',x:upper.props.cup.x}));
  const dropColumn = ball(building).x, woke = !ball(building).sleeping;
  advance(building,180);
  assert.ok(building.input({type:'tap',x:upper.props.cup.x}));
  advance(building,180);
  assert.ok(building.input({type:'grabChair',x:chair.x}));
  for (const x of [-Number.MAX_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE]) {
    assert.ok(building.input({type:'dragChair',x}));
    advance(building,100);
  }
  assert.ok(building.input({type:'releaseChair'}));
  advance(building,180);
  building.setProgress(0.65);
  advance(building,390);
  building.setProgress(0.95);
  advance(building,390);
  const props = [...building.rooms.values()].flatMap(room =>
    Object.entries(room.props).filter(([key])=>key!=='copy').map(([,body])=>({room,body})));
  assert.ok(building.resetCopyBlocks());
  return { woke, dropColumn, drop: hits.find(e=>e.action === 'dropBall').index,
    tap:hits.find(e=>e.action === 'tap').index,
    drag:hits.filter(e=>e.action === 'dragChair').map(e=>[e.index,round(e.dragDistance)]),
    returnAngle:building.angle, returnGravity:[building.world.gx,building.world.gy],
    furnitureOnFloor:props.filter(({room,body})=>body.sleeping && Math.abs(body.bottom-room.bottom) < 0.01).length,
    furniture:props.length };
}

function malformedData() {
  const building = createBuilding(), bad = [];
  for (const [name,attempt] of [
    ['drop x NaN',()=>building.input({type:'dropBall',x:NaN})],
    ['throw speed Infinity',()=>building.input({type:'throwBall',x:120,y:48,vx:Infinity,vy:100})],
    ['chair grab NaN',()=>building.input({type:'grabChair',x:NaN})],
    ['sensor gravity NaN',()=>building.setSensorGravity({x:NaN,y:920})],
    ['turn NaN',()=>building.setProgress(NaN)]
  ]) {
    try { attempt(); bad.push([name,'accepted']); } catch (error) { bad.push([name,error.name]); }
  }
  const record = {time:0,index:100,point:{x:100},force:42,type:'impact'};
  const accepted = building.replay('upper',[record,{...record,time:NaN}]);
  advance(building,720);
  const timestamp = { accepted, ticks:720, playerPending:Boolean(building.player), dropAllowed:building.canInputFor('dropBall') };
  const received = [];
  building.onReceive(event => { if (event.kind === 'replay') received.push(event); });
  const pointAccepted = building.replay('upper',[{...record,index:NaN,point:{x:NaN}}]);
  advance(building,1);
  const point = { accepted:pointAccepted, delivered:received.length,
    index:String(received[0]?.index), x:String(received[0]?.point.x) };
  return { commandValidation:bad, timestamp, point };
}

function throwTrial(command) {
  const building = createBuilding(), indices = [];
  building.onReceive(event => { if (event.action === 'throwBall') indices.push(event.index); });
  assert.ok(building.input({type:'throwBall',...command}));
  const release = [ball(building).x,ball(building).y,ball(building).vx,ball(building).vy];
  advance(building,240);
  return { request:command, release, indices };
}

const motionSource = readFileSync(new URL('../motion/building.js',import.meta.url),'utf8');
const motionWindow = { LandingMotion:{} };
runInNewContext(motionSource,{window:motionWindow,EventTarget,CustomEvent});

function liveCushion(y) {
  const building = createBuilding(), trials = [];
  building.onReceive(event => { if (event.action === 'matDrop') trials.push(event); });
  const timeline = motionWindow.LandingBuilding.createCushionTimeline({reduced:true,drop:{type:'matDrop',y}});
  timeline.setActive(true);
  timeline.advance(1);
  const bare = timeline.beginDrop('bare');
  assert.ok(building.input(bare.command));
  advance(building,180);
  assert.ok(timeline.record(bare.id,{...trials[0],lampAngle:0}));
  assert.ok(timeline.layMat() && building.input({type:'mat',enabled:true}));
  const mat = timeline.beginDrop('mat');
  assert.ok(building.input(mat.command));
  let depthBeforeStep, firstMatContact;
  const launchTick = building.world.tick;
  building.onContact(event => {
    if (event.mat && event.action === 'matDrop' && !firstMatContact) {
      firstMatContact = { step:event.tick-launchTick, bottomMinusMatTopAtTickStart:round(depthBeforeStep),
        substepMs:round(event.dt*1000), speed:round(event.closingSpeed) };
    }
  });
  for (let i=0;i<180;i++) {
    depthBeforeStep = ball(building).bottom-building.mat.top;
    advance(building,1);
  }
  assert.ok(timeline.record(mat.id,{...trials.find(event=>event.mat),lampAngle:0}));
  const {before,after,reduction,frames} = timeline.state.comparison;
  const forceReduction = 100*(1-frames[1].force/frames[0].force);
  return { y, before, after, forceReduction:round(forceReduction), displayedPercent:Math.round(100*reduction), firstMatContact };
}

function scales() {
  const eligible = [];
  let previousBare = Infinity, monotoneBare = true;
  for (let y=26;y<=150.5;y+=0.5) {
    const result = compareMatDrop({y});
    monotoneBare &&= result.bare.index<=previousBare;
    previousBare = result.bare.index;
    if (result.bare.index>=100) eligible.push(result.reduction);
  }
  const jumps = eligible.slice(1).map((value,index)=>Math.abs(value-eligible[index]));
  const maxEligibleReductionJump = Math.max(...jumps);
  assert.ok(monotoneBare && maxEligibleReductionJump < 1.1);
  return { monotoneBare, maxEligibleReductionJump:round(maxEligibleReductionJump),
    eligibleForceReductionRange:[round(Math.min(...eligible)),round(Math.max(...eligible))],
    cushion:[26,26.5,91].map(liveCushion),
    throws:[
      {x:120,y:26,vx:0,vy:600},
      {x:375,y:85,vx:-600,vy:0},
      {x:233,y:85,vx:Number.MAX_VALUE,vy:Number.MAX_VALUE}
    ].map(throwTrial) };
}

const fixedTicks = rates.map(fixedInputTrace);
assert.equal(new Set(fixedTicks.map(result=>result.hash)).size,1,'equal physics ticks must have equal traces');
const rapidReversal = rates.map(hz=>wallClockDrag(hz,{distance:-70,travel:300,wiggle:40}));
assert.equal(new Set(rapidReversal.map(({index,peakForce,distance})=>JSON.stringify([index,peakForce,distance]))).size,1,
  'timestamped samples keep the same index, peak force and distance');
console.log(JSON.stringify({
  fixedTicks,
  wallClock: {
    short:rates.map(hz=>wallClockDrag(hz,{distance:-10,travel:500})),
    long:rates.map(hz=>wallClockDrag(hz,{distance:-200,travel:2000})),
    rapidReversal,
    immediateRapidReversal:rates.map(hz=>wallClockDrag(hz,{distance:-70,travel:300,wiggle:40,timed:false}))
  },
  bursts:[burst(12,12),burst(12,12,{turn:true}),burst(360,1)],
  typeFromSamePresses:[timingType(false),timingType(true)],
  sleepingAndExtreme:sleepingAndExtreme(),
  malformedData:malformedData(),
  scales:scales()
},null,2));
