// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
// Fixed-step damped spring in the accelerating head frame. Gravity restores the
// strand to its authored hanging shape; bounded history makes seeking reproducible.
(function(root){
  function response(time,driver,{length=450,gravity=980,stiffness=16,damping=7}={}){
    if(!(time>0))return 0;
    const dt=1/90,end=Math.floor(time/dt),begin=Math.max(0,end-315);
    let previous=driver(Math.max(0,begin-1)*dt),previous2=driver(Math.max(0,begin-2)*dt),offset=0,velocity=0;
    for(let tick=begin;tick<=end;tick++){
      const current=driver(tick*dt),acceleration=Math.max(-2000,Math.min(2000,(current-2*previous+previous2)/(dt*dt)));
      velocity+=(-acceleration-(gravity/length+stiffness)*offset-damping*velocity)*dt;
      offset+=velocity*dt;previous2=previous;previous=current;
    }
    return Math.max(-.18,Math.min(.18,offset/length));
  }
  const api={response};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.HairDynamics=api;
})(globalThis);
