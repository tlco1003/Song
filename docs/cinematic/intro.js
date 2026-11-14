import React, {createElement as h, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {INTRO_DURATION, journeyAt, smoothstep} from './timeline.mjs';

// Pure Three.js geometry and GLSL; no images, customer data, paid APIs or fake video.
const pointVertex = [
'precision highp float;',
'uniform float uTime,uGather,uTravel,uLanding;',
'uniform vec3 uOrb;',
'attribute vec3 aTarget;',
'attribute float aSeed,aRadius;',
'varying float vSeed,vHalo;',
'void main(){',
' vec3 p=position;',
' p+=vec3(sin(uTime*.24+aSeed*27.)*.06,cos(uTime*.31+aSeed*19.)*.10,0.);',
' vec3 target=aTarget+uOrb+vec3(sin(uTime*.7+aSeed*33.)*.035,cos(uTime*.6+aSeed*30.)*.035,0.);',
' p=mix(p,target,uGather);',
' vec3 trail=vec3(cos(aSeed*43.+uTime*.3),sin(aSeed*45.+uTime*.2),aSeed-.5);',
' p+=trail*uTravel*.23;',
' p=mix(p,vec3(p.x*1.65,-.57+abs(aTarget.y)*.20,.38+abs(aTarget.z)*.05),uLanding*.87);',
' vec4 mv=modelViewMatrix*vec4(p,1.);',
' gl_Position=projectionMatrix*mv;',
' gl_PointSize=min(10.0,(1.2+aRadius*3.4)*(128./max(1.,-mv.z)));',
' vSeed=aSeed;vHalo=.65+.35*sin(uTime*1.9+aSeed*17.);',
'}'
].join('\n');
const pointFragment = [
'precision highp float;',
'varying float vSeed,vHalo;',
'void main(){',
' vec2 uv=gl_PointCoord-.5;',
' float d=length(uv);',
' float core=exp(-d*d*120.);',
' float halo=exp(-d*d*17.);',
' float alpha=(core*.85+halo*.21)*smoothstep(.5,.15,d);',
' vec3 ice=vec3(.49,.71,.95);vec3 lilac=vec3(.59,.56,.85);',
' vec3 col=mix(ice,lilac,smoothstep(.32,.95,vSeed));',
' col=mix(col,vec3(.95,.96,.95),core*.71);',
' gl_FragColor=vec4(col*vHalo,alpha);',
'}'
].join('\n');
const orbVertex = [
'varying vec3 vNormal,vView,vPos;',
'void main(){',
' vec4 mv=modelViewMatrix*vec4(position,1.);',
' vNormal=normalize(normalMatrix*normal);vView=normalize(-mv.xyz);vPos=position;',
' gl_Position=projectionMatrix*mv;',
'}'
].join('\n');
const orbFragment = [
'precision highp float;',
'uniform float uTime,uOpacity;',
'varying vec3 vNormal,vView,vPos;',
'void main(){',
' float rim=pow(1.-abs(dot(normalize(vNormal),normalize(vView))),2.5);',
' float veins=pow(abs(sin(24.*vPos.y+7.*sin(vPos.x*11.+uTime*.5))),17.);',
' vec3 col=mix(vec3(.27,.48,.86),vec3(.86,.94,1.),rim);',
' float alpha=(.05+rim*.72+veins*.05)*uOpacity;',
' gl_FragColor=vec4(col*(.7+rim*1.2),alpha);',
'}'
].join('\n');
const cloudVertex = [
'varying vec2 vUv;',
'void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'
].join('\n');
const cloudFragment = [
'precision highp float;',
'uniform float uTime,uOpacity;',
'varying vec2 vUv;',
'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=noise(p)*a;p=p*2.04+vec2(12.4,7.1);a*=.5;}return v;}',
'void main(){',
' vec2 uv=(vUv-.5)*vec2(2.6,1.5);',
' float f=fbm(uv*2.35+vec2(uTime*.034,-uTime*.015));',
' float envelope=smoothstep(.95,.15,length(uv*vec2(.75,1.1)));',
' float density=smoothstep(.31,.65,f)*envelope;',
' vec3 col=mix(vec3(.16,.29,.43),vec3(.54,.66,.78),f);',
' gl_FragColor=vec4(col,density*uOpacity*.43);',
'}'
].join('\n');
const pageVertex = [
'varying vec2 vUv;',
'void main(){vUv=uv;vec3 p=position;p.z+=.12*sin(vUv.x*3.14159);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}'
].join('\n');
const pageFragment = [
'precision highp float;',
'uniform float uGlow;',
'varying vec2 vUv;',
'void main(){',
' vec2 q=vUv*vec2(30.,22.);',
' vec2 f=abs(fract(q)-.5);',
' float grid=1.-smoothstep(.012,.047,min(f.x,f.y));',
' float lines=exp(-30.*abs(vUv.y-.52))*.16+exp(-35.*abs(vUv.y-.32))*.14;',
' float edges=pow(1.-abs(vUv.x-.5)*2.,1.5);',
' vec3 base=vec3(.065,.10,.16);',
' vec3 col=base+grid*vec3(.08,.14,.20)+lines*vec3(.25,.45,.62)+uGlow*edges*vec3(.045,.09,.16);',
' gl_FragColor=vec4(col,.92);',
'}'
].join('\n');

function Train({time}) {
 const group=useRef();
 useFrame(({clock})=>{
  const j=journeyAt(time.current.value), el=group.current;
  if(!el)return;
  el.visible=j.train>.002;
  el.position.set(-1.2+smoothstep(0,6,j.time)*.55,-.52,-1.38);
  el.rotation.y=-.16+Math.sin(clock.elapsedTime*.12)*.015;
  el.scale.setScalar(1-smoothstep(4.8,7.3,j.time)*.18);
 });
 const parts=[
  h('mesh',{key:'carriage',position:[0,.04,0]},h('boxGeometry',{args:[6.6,1.24,1.48]}),h('meshStandardMaterial',{color:'#101824',metalness:.92,roughness:.24})),
  h('mesh',{key:'roof',position:[0,.73,0]},h('boxGeometry',{args:[6.3,.16,1.47]}),h('meshStandardMaterial',{color:'#202e3c',metalness:.85,roughness:.24})),
  h('mesh',{key:'stripe',position:[0,-.52,.755]},h('boxGeometry',{args:[6.3,.012,.018]}),h('meshBasicMaterial',{color:'#b2b8c5'})),
  h('mesh',{key:'foot',position:[0,-.7,0]},h('boxGeometry',{args:[6.5,.10,1.52]}),h('meshStandardMaterial',{color:'#151d29',metalness:.8,roughness:.35}))
 ];
 for(let i=0;i<8;i++){
  const x=-2.76+i*.79;
  parts.push(h('mesh',{key:'pane'+i,position:[x,.18,.756]},h('planeGeometry',{args:[.55,.55]}),h('meshBasicMaterial',{color:i===2?'#d9d8bd':'#b2bbba',transparent:true,opacity:i===2?.91:.43,side:THREE.DoubleSide})));
  parts.push(h('mesh',{key:'rim'+i,position:[x,.18,.763]},h('planeGeometry',{args:[.63,.63]}),h('meshBasicMaterial',{color:'#718296',transparent:true,opacity:.11,wireframe:true})));
 }
 for(let i=0;i<4;i++){
  const x=-2.4+i*1.6;
  parts.push(h('mesh',{key:'wheel'+i,position:[x,-.82,.48],rotation:[Math.PI/2,0,0]},h('torusGeometry',{args:[.19,.055,8,24]}),h('meshStandardMaterial',{color:'#232b32',metalness:.83,roughness:.4})));
 }
 return h('group',{ref:group},...parts);
}
function MemoryOrb({time}) {
 const group=useRef(), shader=useRef(), inner=useRef();
 const uniforms=useMemo(()=>({uTime:{value:0},uOpacity:{value:0}}),[]);
 useFrame(({clock})=>{
  const j=journeyAt(time.current.value);
  if(!group.current)return;
  group.current.position.set(...j.orb);
  group.current.scale.setScalar(Math.max(.001,j.orbScale));
  group.current.rotation.set(clock.elapsedTime*.09,clock.elapsedTime*.17,0);
  uniforms.uTime.value=clock.elapsedTime;
  uniforms.uOpacity.value=smoothstep(1.5,3.5,j.time);
  if(inner.current)inner.current.material.opacity=.035+.12*j.orbFlight;
 });
 return h('group',{ref:group},
  h('mesh',null,h('icosahedronGeometry',{args:[.86,5]}),h('shaderMaterial',{ref:shader,vertexShader:orbVertex,fragmentShader:orbFragment,uniforms,transparent:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})),
  h('mesh',{ref:inner},h('sphereGeometry',{args:[.64,32,20]}),h('meshPhysicalMaterial',{color:'#94bee8',roughness:.08,metalness:.14,transmission:.85,thickness:1.5,ior:1.34,transparent:true,opacity:.05,depthWrite:false})),
  h('pointLight',{color:'#9fbefa',intensity:3,distance:5})
 );
}
function ParticleCloud({time,quality}) {
 const material=useRef();
 const count=quality==='low'?1500:quality==='medium'?3100:5000;
 const geometry=useMemo(()=>{
  const g=new THREE.BufferGeometry();
  const pos=new Float32Array(count*3), target=new Float32Array(count*3);
  const seed=new Float32Array(count),size=new Float32Array(count);
  for(let i=0;i<count;i++){
   const p=(i+.5)/count, angle=i*2.399963229728653, phi=Math.acos(1-2*p);
   const r=.72+((i*31)%67)/67*.19;
   target[3*i]=Math.sin(phi)*Math.cos(angle)*r;
   target[3*i+1]=Math.cos(phi)*r;
   target[3*i+2]=Math.sin(phi)*Math.sin(angle)*r;
   const spread=((i*131)%997)/997;
   pos[3*i]=-3.7+spread*6.2;pos[3*i+1]=.1+Math.sin(i*2.17)*.91;
   pos[3*i+2]=-1.4+Math.sin(i*1.31)*.53;
   seed[i]=((i*113)%997)/997;size[i]=((i*39)%91)/91;
  }
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  g.setAttribute('aTarget',new THREE.BufferAttribute(target,3));
  g.setAttribute('aSeed',new THREE.BufferAttribute(seed,1));
  g.setAttribute('aRadius',new THREE.BufferAttribute(size,1));
  return g;
 },[count]);
 useEffect(()=>()=>geometry.dispose(),[geometry]);
 const uniforms=useMemo(()=>({uTime:{value:0},uGather:{value:0},uTravel:{value:0},uLanding:{value:0},uOrb:{value:new THREE.Vector3()}}),[]);
 useFrame(({clock})=>{
  const j=journeyAt(time.current.value);
  uniforms.uTime.value=clock.elapsedTime;
  uniforms.uGather.value=j.gather;
  uniforms.uTravel.value=j.orbFlight;
  uniforms.uLanding.value=j.landing;
  uniforms.uOrb.value.set(...j.orb);
 });
 return h('points',{geometry,frustumCulled:false},
  h('shaderMaterial',{ref:material,uniforms,vertexShader:pointVertex,fragmentShader:pointFragment,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})
 );
}
function Clouds({time}) {
 const layers=useMemo(()=>[0,1,2,3].map(()=>({uTime:{value:0},uOpacity:{value:0}})),[]);
 const meshes=useRef([]);
 useFrame(({clock})=>{
  const j=journeyAt(time.current.value);
  for(let i=0;i<layers.length;i++){
   layers[i].uTime.value=clock.elapsedTime+i*13;
   layers[i].uOpacity.value=j.clouds*(.65+i*.1);
   const mesh=meshes.current[i];
   if(mesh){mesh.position.x=Math.sin(clock.elapsedTime*.06+i)*.4+(j.time-7)*(.14+i*.07);mesh.position.y=.36+i*.11;}
  }
 });
 return h('group',null,...layers.map((uniforms,i)=>h('mesh',{key:i,ref:el=>{meshes.current[i]=el},position:[0,0,1.2+i*.63],scale:[1.08+i*.23,.8+i*.15,1]},
  h('planeGeometry',{args:[6.2,3.7]}),
  h('shaderMaterial',{uniforms,vertexShader:cloudVertex,fragmentShader:cloudFragment,transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.NormalBlending})
 )));
}
function Book({time}) {
 const body=useRef(), left=useRef(), right=useRef(), ripple=useRef();
 const uniforms=useMemo(()=>({uGlow:{value:0}}),[]);
 useFrame(({clock})=>{
  const j=journeyAt(time.current.value);
  if(!body.current)return;
  body.current.visible=j.page>.004;
  body.current.position.set(0,-1.08+(.34*j.page),.2);
  body.current.rotation.set(-.16,Math.sin(clock.elapsedTime*.12)*.015,0);
  body.current.scale.setScalar(.62+j.page*.36);
  left.current.rotation.y=-(1-j.bookOpen)*1.42;
  right.current.rotation.y=(1-j.bookOpen)*1.42;
  uniforms.uGlow.value=j.landing;
  if(ripple.current){ripple.current.visible=j.ripple>.001;ripple.current.scale.setScalar(.5+j.ripple*1.8);ripple.current.material.opacity=j.ripple*.7;}
 });
 const page=(side)=>h('group',{ref:side<0?left:right,position:[0,0,0]},
  h('mesh',{position:[side*1.03,0,0]},h('planeGeometry',{args:[2.08,1.56,30,18]}),h('shaderMaterial',{vertexShader:pageVertex,fragmentShader:pageFragment,uniforms,side:THREE.DoubleSide,transparent:true,depthWrite:true})),
  h('mesh',{position:[side*1.04,-.79,-.02]},h('boxGeometry',{args:[2.1,.015,.015]}),h('meshBasicMaterial',{color:'#9cb6d1'}))
 );
 return h('group',{ref:body,visible:false},
  page(-1),page(1),
  h('mesh',{position:[0,0,-.05]},h('boxGeometry',{args:[.018,1.67,.04]}),h('meshBasicMaterial',{color:'#d1e1ed'})),
  h('mesh',{ref:ripple,position:[0,-.14,.32],visible:false},
   h('ringGeometry',{args:[.43,.46,96]}),
   h('meshBasicMaterial',{color:'#bddfff',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}))
 );
}
function CinematicScene({time,quality}) {
 useFrame(({camera,pointer,clock})=>{
  const j=journeyAt(time.current.value);
  camera.position.set(pointer.x*.11+Math.sin(clock.elapsedTime*.11)*.04,.28+pointer.y*.06,j.cameraZ);
  camera.lookAt(0,.08,0);
 });
 return h(React.Fragment,null,
  h('color',{attach:'background',args:['#03070e']}),
  h('fog',{attach:'fog',args:['#03070e',12,26]}),
  h('ambientLight',{intensity:.28}),
  h('pointLight',{position:[-2,2,4],color:'#87a8d1',intensity:23,distance:14}),
  h('pointLight',{position:[3,-1,1],color:'#6375aa',intensity:10,distance:11}),
  h(Train,{time}),h(Clouds,{time}),h(ParticleCloud,{time,quality}),h(MemoryOrb,{time}),h(Book,{time})
 );
}
class SceneBoundary extends React.Component {
 constructor(props){super(props);this.state={failed:false}}
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error){console.warn('Cinematic WebGL fallback:',error)}
 render(){return this.state.failed?null:this.props.children}
}
function Experience() {
 const duration=INTRO_DURATION;
 const clock=useRef({value:0,playing:true,last:null});
 const [playing,setPlaying]=useState(true);
 const [step,setStep]=useState(0);
 const reduced=useMemo(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,[]);
 const quality=useMemo(()=>/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'low':'medium',[]);
 useEffect(()=>{
  if(reduced){clock.current.value=duration;clock.current.playing=false;setPlaying(false);setStep(3);return;}
  let raf=0,st=0;
  const node=document.getElementById('cinematic-phase');
  const phases=['01 / THE JOURNEY','02 / A MEMORY AWAKENS','03 / BEYOND THE CLOUDS','04 / THE PAGE OPENS'];
  const tick=now=>{
   if(clock.current.last!==null && clock.current.playing){
    clock.current.value=Math.min(duration,clock.current.value+(now-clock.current.last)/1000);
   }
   clock.current.last=now;
   const j=journeyAt(clock.current.value);
   if(j.stage!==st){st=j.stage;setStep(st);if(node)node.textContent=phases[st];}
   const line=document.getElementById('cinematic-progress');
   if(line)line.style.width=(j.time/duration*100).toFixed(2)+'%';
   if(j.time>=duration && clock.current.playing){clock.current.playing=false;setPlaying(false);}
   raf=window.requestAnimationFrame(tick);
  };
  raf=window.requestAnimationFrame(tick);
  return()=>window.cancelAnimationFrame(raf);
 },[duration,reduced]);
 const skip=()=>{clock.current.value=duration;clock.current.playing=false;setPlaying(false);setStep(3);
  const phase=document.getElementById('cinematic-phase');if(phase)phase.textContent='04 / THE PAGE OPENS';
 };
 const replay=()=>{if(reduced)return;clock.current.value=0;clock.current.last=null;clock.current.playing=true;setPlaying(true);setStep(0);
  const phase=document.getElementById('cinematic-phase');if(phase)phase.textContent='01 / THE JOURNEY';
 };
 const toggle=()=>{if(clock.current.value>=duration){replay();return;}clock.current.playing=!clock.current.playing;clock.current.last=null;setPlaying(clock.current.playing)};
 useEffect(()=>{
  const control=document.getElementById('cinematic-controls');
  if(!control)return;
  const click=(e)=>{const action=e.target.closest('[data-cinematic-action]')?.dataset.cinematicAction;if(action==='skip')skip();else if(action==='replay')replay();else if(action==='toggle')toggle();};
  control.addEventListener('click',click);return()=>control.removeEventListener('click',click);
 });
 useEffect(()=>{
  const label=document.getElementById('cinematic-state');
  if(label)label.textContent=reduced?'MOTION REDUCED':(playing?'PAUSE':'PLAY');
  const count=document.getElementById('cinematic-counter');
  if(count)count.textContent='0'+(step+1)+' / 04';
 },[playing,step,reduced]);
 if(reduced)return null;
 return h(SceneBoundary,null,h(Canvas,{
   camera:{position:[0,.25,9.6],fov:46,near:.1,far:50},
   dpr:[1,quality==='low'?1.2:1.7],
   gl:{antialias:quality!=='low',alpha:false,powerPreference:'high-performance'},
   onCreated:()=>document.getElementById('cinematic-intro')?.classList.add('song-cinematic--ready')
 },h(CinematicScene,{time:clock,quality})));
}
const mount=document.getElementById('cinematic-canvas');
if(mount)createRoot(mount).render(h(Experience));
