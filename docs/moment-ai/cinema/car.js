/* MOMENT AI / MOTION ATELIER — independent procedural 3D vehicle assembly.
 * Canvas2D 3D projection: built from original geometry; no car asset / trademark used.
 * Drawn on a separate canvas; no access to user data, vehicle SDK or private engines.
 */
(() => {
 'use strict';
 const TAU=Math.PI*2;
 const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
 const mix=(a,b,t)=>a+(b-a)*t;
 const rgb=(r,g,b,a=1)=>`rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
 const white=[215,224,231], dark=[20,28,39], chrome=[144,172,191], glass=[32,57,75], night=[9,14,24];
 const vertices=[
  [-2.54,.56,-1.04],[2.45,.56,-1.04],[2.45,.98,-1.04],[1.50,1.17,-1.04],[-1.78,1.15,-1.04],[-2.54,.88,-1.04],
  [-2.54,.56,1.04],[2.45,.56,1.04],[2.45,.98,1.04],[1.50,1.17,1.04],[-1.78,1.15,1.04],[-2.54,.88,1.04]
 ];
 class MomentCar {
   constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:true});this.isMobile=matchMedia('(max-width:760px)');this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.progress=0;this.target=0;this.yaw=0.5;this.targetYaw=.5;this.pitch=.16;this.t=0;this.active=true;this.frameId=0;this.resize();this.boundResize=()=>this.resize();window.addEventListener('resize',this.boundResize,{passive:true});document.addEventListener('visibilitychange',()=>{if(!document.hidden){this.t=0;this.request()}});this.request();}
   resize(){const mobile=this.isMobile.matches,dpr=Math.min(devicePixelRatio||1,mobile?1.4:1.8),r=this.canvas.getBoundingClientRect();this.W=Math.max(1,Math.round(r.width*dpr));this.H=Math.max(1,Math.round(r.height*dpr));this.canvas.width=this.W;this.canvas.height=this.H;this.scale=Math.min(this.W*(mobile?.132:.088),this.H*(mobile?.185:.24));this.cx=this.W*(mobile?.51:.76);this.cy=this.H*(mobile?.565:.56);this.request();}
   request(){if(!this.frameId&&this.active)this.frameId=requestAnimationFrame(t=>this.frame(t));}
   setProgress(p){this.target=clamp(p);this.request();}
   setReduced(v){this.reduced=!!v;if(v){this.progress=this.target;this.yaw=this.targetYaw;}this.request();}
   rotate(delta){this.targetYaw=clamp(this.targetYaw+delta,-.30,1.22);this.request();}
   setActive(v){this.active=!!v;if(this.active)this.request();else if(this.frameId){cancelAnimationFrame(this.frameId);this.frameId=0;}}
   project(v){const [x,y,z]=v,ca=Math.cos(this.yaw),sa=Math.sin(this.yaw),cp=Math.cos(this.pitch),sp=Math.sin(this.pitch);let xx=x*ca-z*sa,zz=x*sa+z*ca;let yy=y*cp-zz*sp;zz=y*sp+zz*cp;const f=7.7/(7.7-zz*.25);return [this.cx+xx*this.scale*f,this.cy-yy*this.scale*f,zz,f];}
   stage(a,b){return ease((this.progress-a)/(b-a));}
   partVert(p,phase,offset){const f=this.stage(phase[0],phase[1]);return [p[0]+offset[0]*(1-f),p[1]+offset[1]*(1-f),p[2]+offset[2]*(1-f)];}
   poly(pts,fill,alpha=1,edge=null,width=1){const ctx=this.ctx;if(alpha<=0)return;ctx.save();ctx.globalAlpha=alpha;ctx.beginPath();pts.forEach((p,i)=>{const q=this.project(p);i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]);});ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(edge){ctx.strokeStyle=edge;ctx.lineWidth=width*Math.max(1,this.W/1300);ctx.stroke();}ctx.restore();}
   line(a,b,color,width=1,opacity=1){if(opacity<=0)return;const p=this.project(a),q=this.project(b),ctx=this.ctx;ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width*Math.max(1,this.W/1200);ctx.globalAlpha=opacity;ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();ctx.restore();}
   fillFace(points,stage,offset,palette,alpha=1,edge=null){const f=this.stage(...stage);if(f<=.003)return;this.poly(points.map(v=>this.partVert(v,stage,offset)),palette,alpha*f,edge,0.7);}
   wheel(x,z,phase,isFar){const a=this.stage(...phase);if(a<=.001)return;const y=.48,r=.47,ctx=this.ctx;const pts=(rad,off,tilt=0)=>Array.from({length:44},(_,i)=>{const q=i/44*TAU;return [x+Math.cos(q)*rad,y+Math.sin(q)*rad,z+off+tilt]});const off=isFar?-2.0:1.8;const shift=off*(1-a);const rz=z+shift;const path=(rad,depth)=>pts(rad,depth).map(p=>this.project([p[0],p[1],rz+p[2]-z]));const drawCircle=(rad,depth,fill,stroke)=>{const arr=path(rad,depth);ctx.beginPath();arr.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.2*this.W/1400;ctx.stroke();}};ctx.save();ctx.globalAlpha=a;drawCircle(r,.11,'#070b11','rgba(206,218,231,.24)');drawCircle(r*.79,.128,'#202d3c','rgba(154,192,216,.5)');drawCircle(r*.66,.142,'#647787','rgba(226,239,250,.6)');for(let i=0;i<9;i++){const q=i*TAU/9+this.yaw*.1;const p=this.project([x+Math.cos(q)*r*.18,y+Math.sin(q)*r*.18,rz+.15]),v=this.project([x+Math.cos(q+.18)*r*.60,y+Math.sin(q+.18)*r*.60,rz+.15]);ctx.strokeStyle='rgba(220,231,240,.73)';ctx.lineWidth=Math.max(1,this.W/1200*3);ctx.beginPath();ctx.moveTo(...p.slice(0,2));ctx.lineTo(...v.slice(0,2));ctx.stroke();}drawCircle(r*.16,.16,'#c0ccd6','#dae3e7');ctx.restore();}
   drawFloor(){const ctx=this.ctx,{cx,cy,scale}=this;const a=this.stage(0,.4);ctx.save();const g=ctx.createRadialGradient(cx,cy+scale*.45,scale*.2,cx,cy+scale*.45,scale*3.5);g.addColorStop(0,`rgba(130,164,190,${a*.17})`);g.addColorStop(.54,`rgba(50,72,94,${a*.07})`);g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.ellipse(cx,cy+scale*.48,scale*3.7,scale*.86,0,0,TAU);ctx.fill();ctx.restore();let p=this.stage(0,.2);if(p>0){for(let i=-4;i<=4;i++){this.line([-3,-.04,i*.36],[3,-.04,i*.36],`rgba(170,199,225,${(.05+Math.abs(i)*-.004)})`,.7,p);}}}
   drawChassis(){const s=[.04,.26],p=this.stage(...s),blue='rgba(114,155,185,.85)',faint='rgba(169,204,228,.53)';if(p<=0)return;const bars=[[-2.2,.47,-.78,2.25,.47,-.78],[-2.2,.47,.78,2.25,.47,.78],[-1.85,.46,-.8,-1.85,.46,.8],[1.90,.46,-.8,1.90,.46,.8],[0,.46,-.8,0,.46,.8]];for(const b of bars){const x=this.partVert(b.slice(0,3),s,[0,-1.3,-.2]),y=this.partVert(b.slice(3),s,[0,-1.3,-.2]);this.line(x,y,blue,3,p);}this.line([-2.25,.5,0],[2.25,.5,0],faint,2,p);}
   drawBody(){
     const b=[.31,.65],o=[.15,-1.6,.55],roof=[.58,.81],ro=[-.6,2.4,-.25];
     const shade=(a,b,c,al)=>rgb(a,b,c,al);
     const far=vertices.slice(0,6),near=vertices.slice(6,12);
     this.fillFace(far,b,o,'#36495d',.95,'rgba(207,225,238,.23)');
     this.fillFace([far[5],far[4],near[4],near[5]],b,o,'#536477',1);
     this.fillFace([far[4],far[3],near[3],near[4]],b,o,'#65778b',1,'rgba(240,245,248,.20)');
     this.fillFace([far[3],far[2],near[2],near[3]],b,o,'#718297',1);
     this.fillFace([far[2],far[1],near[1],near[2]],b,o,'#90a0b1',1);
     this.fillFace([far[0],far[5],near[5],near[0]],b,o,'#203146',1);
     this.fillFace(near,b,o,'#314459',1,'rgba(188,213,232,.47)');
     const lowerNear=[near[0],near[1],[2.45,.72,1.048],[-2.54,.72,1.048]];
     this.fillFace(lowerNear,[.44,.69],[.10,-1.7,.9],'#1d293b',1);
     const roofNear=[[ -1.30,1.77, .85],[.47,1.77,.85],[1.52,1.16,.98],[-1.80,1.16,.98]];
     const roofFar=roofNear.map(p=>[p[0],p[1],-.85]);
     this.fillFace([roofNear[0],roofNear[1],roofFar[1],roofFar[0]],roof,ro,'#899eac',1,'rgba(235,245,250,.65)');
     this.fillFace([roofFar[0],roofFar[1],roofFar[2],roofFar[3]],roof,ro,'#526375',1);
     this.fillFace([roofNear[0],roofNear[1],roofNear[2],roofNear[3]],roof,ro,'#15283a',.95,'rgba(203,224,235,.5)');
     this.fillFace([roofNear[1],roofFar[1],roofFar[2],roofNear[2]],roof,ro,'#253e4c',.97,'rgba(206,228,242,.44)');
     this.fillFace([roofNear[0],roofFar[0],roofFar[3],roofNear[3]],roof,ro,'#223547',1);
     const win=[[ -.92,1.63,1.002],[.23,1.63,1.002],[1.22,1.19,1.012],[-.98,1.19,1.012]];
     const win2=[[-1.23,1.62,1.012],[-1.04,1.62,1.012],[-1.1,1.19,1.012],[-1.66,1.19,1.012]];
     this.fillFace(win,roof,ro,'rgba(47,90,110,.92)',1,'rgba(190,226,243,.43)');
     this.fillFace(win2,roof,ro,'rgba(39,78,100,.9)',1,'rgba(189,212,224,.43)');
     // structural B-pillar and refined linework are independent final assembly pieces
     const trim=this.stage(.72,.91);if(trim>0){
       this.line([-1.03,1.18,1.052],[-1.03,1.70,.95],'#a8c2d0',1.9,trim);
       this.line([-.17,1.17,1.055],[-.11,1.71,.90],'#b6cbd8',2,trim);
       this.line([-1.70,1.14,1.054],[1.34,1.14,1.054],'rgba(224,236,241,.63)',1.3,trim);
       this.line([.12,.77,1.057],[.12,1.13,1.057],'rgba(10,19,29,.73)',1.1,trim);
       this.line([-1.06,.78,1.057],[-1.06,1.13,1.057],'rgba(10,19,29,.73)',1.1,trim);
       this.line([-1.88,.78,1.058],[1.87,.78,1.058],'rgba(193,214,226,.49)',1.0,trim);
       this.line([.43,1.01,1.062],[.68,1.01,1.062],'#d5dce0',2.2,trim);
       this.line([-1.30,1.01,1.062],[-1.05,1.01,1.062],'#cbd7dc',2,trim);
     }
     // headlights, red rear lights and restrained accent are late-stage, not imaginary active car controls
     const lights=[.82,1];const lo=[2.4,0,0];
     this.fillFace([[2.458,.77,.72],[2.46,.84,.74],[2.46,.82,.99],[2.458,.73,.99]],lights,[-2.1,.2,0],'rgba(225,240,250,.95)',1,'rgba(246,249,248,.8)');
     this.fillFace([[2.458,.77,-.72],[2.46,.84,-.74],[2.46,.82,-.99],[2.458,.73,-.99]],lights,[-2.1,.2,0],'rgba(222,238,250,.95)',1);
     this.fillFace([[-2.55,.74,.6],[-2.55,.84,.6],[-2.55,.84,.98],[-2.55,.73,.98]],lights,[0,.3,2],'rgba(217,70,78,.9)',1);
     const l=this.stage(...lights);if(l>.01){this.line([2.44,.58,-.78],[2.44,.58,.78],'rgba(172,203,223,.54)',2,l);this.line([-2.42,.59,1.06],[2.38,.59,1.06],'rgba(185,200,211,.29)',2,l);}
   }
   draw(t){const ctx=this.ctx;if(!ctx)return;ctx.clearRect(0,0,this.W,this.H);if(this.progress<=0.001){this.drawFloor();return;}this.drawFloor();this.drawChassis();for(const x of [-1.57,1.58])this.wheel(x,-.96,[.10,.37],true);this.drawBody();for(const x of [-1.57,1.58])this.wheel(x,1.09,[.15,.39],false);const finish=this.stage(.85,1);if(finish>.01){const glow=ctx.createRadialGradient(this.cx,this.cy-this.scale*.4,1,this.cx,this.cy-this.scale*.4,this.scale*4.8);glow.addColorStop(0,`rgba(180,214,242,${finish*.075})`);glow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,this.W,this.H);}}
   frame(t){this.frameId=0;if(!this.active)return;const delta=this.t?Math.min(.08,(t-this.t)/1000):.016;this.t=t;const k=this.reduced?1:1-Math.exp(-delta*5.2);this.progress=mix(this.progress,this.target,k);this.yaw=mix(this.yaw,this.targetYaw,k);this.draw(t/1000);if((Math.abs(this.progress-this.target)>.001||Math.abs(this.yaw-this.targetYaw)>.001)&&!document.hidden)this.request();}
 }
 window.MomentCar=MomentCar;
})();