import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { World } from './engine.js';
import { createBuilding } from './building.js';

const dt = 1/120;
const measured = 600;
const width = 880, height = 500;
const t = 52, size = 17;
const fixtures = [
  {radius:size/2},
  {width:size,height:size*0.8},
  {vertices:[{x:0,y:-size/2},{x:size/2,y:size/2},{x:-size/2,y:size/2}]}
];

function scene(count) {
  const world = new World({gy:780,cell:30,iterations:10,sleep:false});
  world.add({fixed:true,width,height:t,x:width/2,y:height+t/2});
  world.add({fixed:true,width:t,height:height+2*t,x:-t/2,y:height/2});
  world.add({fixed:true,width:t,height:height+2*t,x:width+t/2,y:height/2});
  world.add({fixed:true,width,height:t,x:width/2,y:-t/2});
  for (let i=0; i<count; i++) {
    world.add({
      ...fixtures[i%3],x:width*(i%25+0.5)/25,y:34+27*Math.floor(i/25),
      angle:(i%9-4)*0.13,vx:(i%7-3)*7,spin:(i%5-2)*0.7,restitution:0.22
    });
  }
  return world;
}

console.log('동적 바디 | 중앙값 (스텝/초) | 세 회 범위 (스텝/초)');
for (const count of [50,150,300]) {
  const samples = [];
  for (let run=0; run<3; run++) {
    const world = scene(count);
    for (let i=0; i<240; i++) world.step(dt);
    const start = performance.now();
    for (let i=0; i<measured; i++) world.step(dt);
    samples.push(Math.round(1000*measured/(performance.now()-start)));
    assert.ok(world.bodies.slice(4).every(b => b.x >= -2 && b.x <= width+2 &&
      b.y >= -2 && b.y <= height+2 && Number.isFinite(b.angle)), 'bodies remain in the arena');
  }
  samples.sort((a,b) => a-b);
  console.log(`${count} | ${samples[1]} | ${samples[0]}–${samples[2]}`);
}

console.log('건물 | 동적 | 고정 | 중앙값 (ms/스텝) | P95 (ms/스텝)');
for (const padded of [false,true]) {
  const building = createBuilding();
  building.input({type:'mat',enabled:padded});
  const bodies = [...building.world.bodies,...building.lampWorld.bodies];
  const dynamic = bodies.filter(body => body.inv).length;
  const samples = [];
  for (let i=0;i<2040;i++) {
    const phase = i%360;
    if (phase === 0) building.input({type:'throwBall',x:120,y:65,vx:280,vy:-240});
    if (phase === 120) building.input({type:'dragChair',distance:i%720 < 360 ? -60 : 60});
    if (phase === 240) building.input({type:'matDrop'});
    const start = performance.now();
    building.step();
    if (i >= 240) samples.push(performance.now()-start);
  }
  samples.sort((a,b) => a-b);
  const median = samples[Math.floor(samples.length*0.5)];
  const p95 = samples[Math.floor(samples.length*0.95)];
  console.log(`${padded ? '매트' : '맨바닥'} | ${dynamic} | ${bodies.length-dynamic} | ${median.toFixed(3)} | ${p95.toFixed(3)}`);
}
