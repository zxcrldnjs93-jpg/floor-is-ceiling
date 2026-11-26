export function recordImpacts(world, {filter=()=>true, limit=Infinity}={}) {
  if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1)) {
    throw new RangeError('Expected a positive impact limit');
  }
  const events = [];
  const start = world.tick, time = world.time;
  const stop = world.onImpact(event => {
    if (!filter(event)) return;
    const {a,b,point,normal,...values} = event;
    events.push({
      ...values, aId:a.id, bId:b.id, tangentImpulse:values.tangentImpulse+0,
      point:{x:point.x+0,y:point.y+0}, normal:{x:normal.x+0,y:normal.y+0},
      tick:event.tick-start, time:event.time-time
    });
    if (events.length > limit) events.shift();
  });
  return {snapshot:() => structuredClone(events),stop};
}

export function recordRun(world, {apply, filter, dt=1/120}={}) {
  if (typeof apply !== 'function' || !Number.isFinite(dt) || dt <= 0) {
    throw new TypeError('Expected an input dispatcher and a positive timestep');
  }
  const start = world.tick;
  const track = recordImpacts(world,{filter});
  const inputs = [];
  let end;
  function snapshot() {
    return {dt,steps:(end ?? world.tick)-start,inputs:structuredClone(inputs),impacts:track.snapshot()};
  }
  return {
    input(value) {
      if (end !== undefined) throw new Error('Recording has stopped');
      const command = structuredClone(value);
      const tick = world.tick-start;
      apply(world,value);
      inputs.push({tick,value:command});
    },
    step(step=dt) {
      if (end !== undefined) throw new Error('Recording has stopped');
      if (step !== dt) throw new RangeError('A recorded run needs a fixed timestep');
      world.step(dt);
    },
    snapshot,
    stop() {
      end ??= world.tick;
      track.stop();
      return snapshot();
    }
  };
}

export function replayRun(world, tape, {apply,filter}={}) {
  if (!Number.isSafeInteger(tape.steps) || tape.steps < 0) throw new RangeError('Invalid tape length');
  let previous = 0;
  for (const {tick} of tape.inputs) {
    if (!Number.isSafeInteger(tick) || tick < previous || tick > tape.steps) {
      throw new RangeError('Invalid input tick');
    }
    previous = tick;
  }
  const run = recordRun(world,{apply,filter,dt:tape.dt});
  let index = 0;
  try {
    for (let tick=0; tick<=tape.steps; tick++) {
      while (tape.inputs[index]?.tick === tick) run.input(structuredClone(tape.inputs[index++].value));
      if (tick < tape.steps) run.step();
    }
  } catch (error) {
    run.stop();
    throw error;
  }
  return run.stop();
}

export function playImpactTrack(events, onImpact, {from=0}={}) {
  if (!Number.isFinite(from) || events.some(event => !Number.isFinite(event?.time))) {
    throw new RangeError('Invalid replay time');
  }
  let index = 0, time = from;
  return {
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid replay timestep');
      time += dt;
      while (index < events.length && events[index].time <= time+1e-9) {
        onImpact(events[index++]);
      }
    },
    get done() { return index === events.length; }
  };
}
