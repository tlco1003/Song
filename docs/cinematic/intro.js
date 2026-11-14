import React, {createElement as h, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame} from '@react-three/fiber';
import * as THREE from 'three';
import {INTRO_DURATION, journeyAt, smoothstep, clamp} from './timeline.mjs';

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
' float alpha=(core*.85+halo*.21)*(1.0-smoothstep(.18,.50,d));',
' vec3 ice=vec3(.64,.86,1.0);vec3 lilac=vec3(1.0,.82,.53);',
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
' vec3 col=mix(vec3(.49,.76,1.),vec3(1.0,.91,.64),rim);',
' float alpha=(.17+rim*.84+veins*.11)*uOpacity;',
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
' float envelope=(1.0-smoothstep(.15,1.15,length(uv*vec2(.75,1.1))));',
' float density=smoothstep(.31,.65,f)*envelope;',
' vec3 col=mix(vec3(.27,.47,.63),vec3(.90,.96,1.),f);',
' gl_FragColor=vec4(col,density*uOpacity*.69);',
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
' vec3 base=vec3(.15,.23,.32);',
' vec3 col=base+grid*vec3(.12,.19,.25)+lines*vec3(.35,.55,.75)+uGlow*edges*vec3(.22,.23,.12);',
' gl_FragColor=vec4(col,.96);',
'}'
].join('\n');

function Train({time}) {
 const group=useRef();
 const shell=useMemo(()=>{
  const shape=new THREE.Shape();
  shape.moveTo(-3.26,-.58);
  shape.lineTo(3.20,-.58);
  shape.quadraticCurveTo(3.32,-.58,3.32,-.42);
  shape.lineTo(3.32,.48);
  shape.quadraticCurveTo(3.32,.61,3.18,.64);
  shape.lineTo(-3.14,.64);
  shape.quadraticCurveTo(-3.31,.61,-3.31,.43);
  shape.lineTo(-3.31,-.43);
  shape.quadraticCurveTo(-3.31,-.58,-3.26,-.58);
  return new THREE.ExtrudeGeometry(shape,{depth:1.38,bevelEnabled:true,steps:1,bevelThickness:.075,bevelSize:.06,bevelSegments:3,curveSegments:6});
 },[]);
 useEffect(()=>()=>shell.dispose(),[shell]);
 useFrame(()=>{
  const j=journeyAt(time.current.value),el=group.current;
  if(!el)return;
  el.visible=j.train>.005;
  el.position.set(-.45+smoothstep(0,6,j.time)*.45,-.38,-1.12);
  el.rotation.y=-.21+Math.sin(j.time*.2)*.012;
  el.scale.setScalar(1-smoothstep(4.9,7.3,j.time)*.14);
 });
 const parts=[
  h('mesh',{key:'shell',geometry:shell,position:[0,0,-.7]},
    h('meshStandardMaterial',{color:'#667f91',metalness:.46,roughness:.3,emissive:'#152c40',emissiveIntensity:.27})),
  h('mesh',{key:'roof',position:[0,.73,0]},
    h('boxGeometry',{args:[6.5,.16,1.51]}),
    h('meshStandardMaterial',{color:'#c0c7c7',metalness:.49,roughness:.34})),
  h('mesh',{key:'roof-highlight',position:[0,.82,.37]},
    h('boxGeometry',{args:[6.3,.026,.055]}),
    h('meshBasicMaterial',{color:'#cfe6f5'})),
  h('mesh',{key:'underbody',position:[0,-.65,0]},
    h('boxGeometry',{args:[6.45,.14,1.45]}),
    h('meshStandardMaterial',{color:'#344657',metalness:.57,roughness:.31})),
  h('mesh',{key:'beltrail',position:[0,-.52,.79]},
    h('boxGeometry',{args:[6.48,.027,.05]}),
    h('meshBasicMaterial',{color:'#f3deba'})),
  h('mesh',{key:'uppertrim',position:[0,.53,.79]},
    h('boxGeometry',{args:[6.46,.021,.037]}),
    h('meshBasicMaterial',{color:'#ddeff5'})),
  h('mesh',{key:'door',position:[2.9,-.02,.79]},
    h('planeGeometry',{args:[.41,.97]}),
    h('meshStandardMaterial',{color:'#2d4758',metalness:.55,roughness:.3})),
  h('mesh',{key:'door-trim',position:[2.9,.31,.803]},
    h('planeGeometry',{args:[.32,.25]}),
    h('meshBasicMaterial',{color:'#c9e0dd'}))
 ];
 for(let i=0;i<7;i++){
  const x=-2.76+i*.81;
  const gold=i%3===1;
  parts.push(h('mesh',{key:'glass'+i,position:[x,.15,.805]},
   h('planeGeometry',{args:[.625,.57]}),
   h('meshBasicMaterial',{color:gold?'#ffe8b5':'#b9e9f7',transparent:true,opacity:gold?.97:.86,side:THREE.DoubleSide})));
  parts.push(h('mesh',{key:'inside'+i,position:[x,.09,.81]},
   h('planeGeometry',{args:[.36,.28]}),
   h('meshBasicMaterial',{color:'#243c53',transparent:true,opacity:.34})));
  parts.push(h('mesh',{key:'frame'+i,position:[x,.15,.82]},
   h('planeGeometry',{args:[.66,.61]}),
   h('meshBasicMaterial',{color:'#d8e7ea',transparent:true,opacity:.66,wireframe:true})));
  parts.push(h('mesh',{key:'mullion'+i,position:[x,.15,.823]},
   h('planeGeometry',{args:[.021,.57]}),
   h('meshBasicMaterial',{color:'#b9c7ce'})));
 }
 for(let i=0;i<4;i++){
  const x=-2.4+i*1.6;
  parts.push(h('mesh',{key:'wheel'+i,position:[x,-.83,.49],rotation:[Math.PI/2,0,0]},
   h('torusGeometry',{args:[.18,.054,10,32]}),
   h('meshStandardMaterial',{color:'#cad6dc',metalness:.62,roughness:.36})));
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
  group.current.scale.setScalar(Math.max(.001,j.orbScale*1.38));
  group.current.rotation.set(j.time*.2,j.time*.29,0);
  uniforms.uTime.value=j.time;
  uniforms.uOpacity.value=smoothstep(1.5,3.5,j.time);
  if(inner.current)inner.current.material.opacity=.035+.12*j.orbFlight;
 });
 return h('group',{ref:group},
  h('mesh',null,h('icosahedronGeometry',{args:[.86,5]}),h('shaderMaterial',{ref:shader,vertexShader:orbVertex,fragmentShader:orbFragment,uniforms,transparent:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false})),
  h('mesh',{ref:inner},h('sphereGeometry',{args:[.64,32,20]}),h('meshPhysicalMaterial',{color:'#d5ebff',roughness:.08,metalness:.14,transmission:.85,thickness:1.5,ior:1.34,transparent:true,opacity:.05,depthWrite:false})),
  h('pointLight',{color:'#fff0cd',intensity:16,distance:7})
 );
}
function ParticleCloud({time,quality}) {
 const material=useRef();
 const count=quality==='low'?2400:quality==='medium'?4600:7000;
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
  uniforms.uTime.value=j.time;
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
   layers[i].uOpacity.value=j.clouds*(.84+i*.08);
   const mesh=meshes.current[i];
   if(mesh){mesh.position.x=Math.sin(j.time*.13+i)*.4+(j.time-7)*(.14+i*.07);mesh.position.y=.36+i*.11;}
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
  body.current.position.set(0,-.65+(.24*j.page),.4);
  body.current.rotation.set(-.12,Math.sin(j.time*.12)*.015,0);
  body.current.scale.setScalar(.82+j.page*.58);
  left.current.rotation.y=-(1-j.bookOpen)*1.42;
  right.current.rotation.y=(1-j.bookOpen)*1.42;
  uniforms.uGlow.value=j.landing;
  if(ripple.current){ripple.current.visible=j.ripple>.001;ripple.current.scale.setScalar(.5+j.ripple*1.8);ripple.current.material.opacity=j.ripple*.7;}
 });
 const page=(side)=>h('group',{ref:side<0?left:right,position:[0,0,0]},
  h('mesh',{position:[side*1.03,0,-.038]},h('planeGeometry',{args:[2.14,1.62]}),
   h('meshBasicMaterial',{color:'#638fa5',side:THREE.DoubleSide,transparent:true,opacity:.86})),
  h('mesh',{position:[side*1.03,0,.012]},h('planeGeometry',{args:[2.08,1.56,30,18]}),
   h('shaderMaterial',{vertexShader:pageVertex,fragmentShader:pageFragment,uniforms,side:THREE.DoubleSide,transparent:true,depthWrite:false})),
  h('mesh',{position:[side*1.03,0,.031]},h('planeGeometry',{args:[2.13,1.60]}),
   h('meshBasicMaterial',{color:'#cdeefe',transparent:true,opacity:.85,wireframe:true,side:THREE.DoubleSide,depthWrite:false})),
  h('mesh',{position:[side*1.07,.30,.04]},h('planeGeometry',{args:[1.42,.024]}),
   h('meshBasicMaterial',{color:'#f2d59b',transparent:true,opacity:.81,depthWrite:false})),
  h('mesh',{position:[side*1.07,.11,.04]},h('planeGeometry',{args:[1.62,.014]}),
   h('meshBasicMaterial',{color:'#d7f0ff',transparent:true,opacity:.61,depthWrite:false})),
  h('mesh',{position:[side*1.07,-.13,.04]},h('planeGeometry',{args:[1.48,.014]}),
   h('meshBasicMaterial',{color:'#d7f0ff',transparent:true,opacity:.48,depthWrite:false})),
  h('mesh',{position:[side*1.04,-.79,-.02]},h('boxGeometry',{args:[2.12,.019,.019]}),
   h('meshBasicMaterial',{color:'#e1f5ff'}))
 );
 return h('group',{ref:body,visible:false},
  page(-1),page(1),
  h('mesh',{position:[0,0,-.05]},h('boxGeometry',{args:[.018,1.67,.04]}),h('meshBasicMaterial',{color:'#f4e6c5'})),
  h('mesh',{ref:ripple,position:[0,-.14,.32],visible:false},
   h('ringGeometry',{args:[.43,.46,96]}),
   h('meshBasicMaterial',{color:'#ffe5ae',transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}))
 );
}
function CinematicScene({time,quality}) {
 const current=useRef(new THREE.Vector3(0,.32,9.1));
 useFrame(({camera})=>{
  const j=journeyAt(time.current.value);
  const pointer=time.current.pointer;
  const mobile=quality==='low';
  const targetX=mobile?pointer.x*.12:pointer.x*.33;
  const targetY=.24+(mobile?pointer.y*.07:pointer.y*.21);
  current.current.lerp(new THREE.Vector3(targetX,targetY,j.cameraZ-.55),.085);
  camera.position.copy(current.current);
  camera.lookAt(0,.12,0);
 });
 return h(React.Fragment,null,
  h('color',{attach:'background',args:['#15263a']}),
  h('fog',{attach:'fog',args:['#253c52',14,35]}),
  h('ambientLight',{intensity:1.8,color:'#cde9ff'}),
  h('hemisphereLight',{args:['#f2f4ff','#4b6680',2.1]}),
  h('directionalLight',{position:[-3,6,5],intensity:5,color:'#fff0cb'}),
  h('directionalLight',{position:[4,1,7],intensity:4,color:'#c5e6ff'}),
  h('pointLight',{position:[2,2,5],color:'#f9d3a4',intensity:28,distance:15}),
  h('pointLight',{position:[-3,-1,5],color:'#77c4f7',intensity:20,distance:12}),
  h('group',{position:[quality==='low'?.55:1.25,.12,0]},
   h(Train,{time}),h(Clouds,{time}),h(ParticleCloud,{time,quality}),h(MemoryOrb,{time}),h(Book,{time}))
 );
}
class SceneBoundary extends React.Component {
 constructor(props){super(props);this.state={failed:false}}
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error){console.warn('Cinematic WebGL fallback:',error)}
 render(){return this.state.failed?null:this.props.children}
}
function Experience() {
 const time=useRef({value:0,pointer:new THREE.Vector2(0,0)});
 const reduced=useMemo(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,[]);
 const quality=useMemo(()=>/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'low':'medium',[]);
 useEffect(()=>{
  const section=document.getElementById('cinematic-intro');
  const stage=section?.querySelector('.song-cinematic__stage');
  const progress=document.getElementById('cinematic-progress');
  const phase=document.getElementById('cinematic-phase');
  const count=document.getElementById('cinematic-counter');
  const status=document.getElementById('cinematic-state');
  const controls=document.getElementById('cinematic-controls');
  if(!section||!stage)return;
  const phases=['01 / THE JOURNEY','02 / A MEMORY AWAKENS','03 / BEYOND THE CLOUDS','04 / THE PAGE OPENS'];
  let lastStep=-1,dragging=false,lastY=0;
  const onScroll=()=>{
   const rect=section.getBoundingClientRect();
   const travel=Math.max(1,section.offsetHeight-window.innerHeight);
   const ratio=clamp(-rect.top/travel);
   time.current.value=ratio*INTRO_DURATION;
   const j=journeyAt(time.current.value);
   if(progress)progress.style.width=(ratio*100).toFixed(2)+'%';
   if(j.stage!==lastStep){
    lastStep=j.stage;
    if(phase)phase.textContent=phases[j.stage];
    if(count)count.textContent='0'+(j.stage+1)+' / 04';
   }
   if(status)status.textContent=reduced?'MOTION REDUCED':'SCROLL TO EXPLORE';
  };
  const seek=ratio=>{
   const top=section.getBoundingClientRect().top+window.scrollY;
   const travel=Math.max(1,section.offsetHeight-window.innerHeight);
   window.scrollTo({top:top+travel*clamp(ratio),behavior:'auto'});
   onScroll();
  };
  const onClick=e=>{
   const action=e.target.closest('[data-cinematic-action]')?.dataset.cinematicAction;
   if(action==='skip')seek(1);
   else if(action==='replay')seek(0);
  };
  const onDown=e=>{
   if(e.pointerType==='mouse'&&e.button===0&&!e.target.closest('a,button')){
    dragging=true;lastY=e.clientY;
   }
  };
  const onPointer=e=>{
   const rect=stage.getBoundingClientRect();
   const inside=e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom;
   if(inside){
    time.current.pointer.set(
     clamp((e.clientX-rect.left)/Math.max(1,rect.width),0,1)*2-1,
     1-clamp((e.clientY-rect.top)/Math.max(1,rect.height),0,1)*2
    );
   }
   if(dragging&&e.pointerType==='mouse'){
    const delta=e.clientY-lastY;lastY=e.clientY;
    if(Math.abs(delta)>.05)window.scrollBy({top:-delta*2.35,behavior:'instant'});
   }
  };
  const onUp=()=>{dragging=false};
  const onTouch=e=>{
   const touch=e.touches[0];if(touch)onPointer({clientX:touch.clientX,clientY:touch.clientY,pointerType:'touch'});
  };
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll,{passive:true});
  window.addEventListener('pointermove',onPointer,{passive:true});
  window.addEventListener('pointerup',onUp,{passive:true});
  window.addEventListener('blur',onUp);
  stage.addEventListener('pointerdown',onDown);
  stage.addEventListener('touchmove',onTouch,{passive:true});
  controls?.addEventListener('click',onClick);
  onScroll();
  return()=>{
   window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);
   window.removeEventListener('pointermove',onPointer);window.removeEventListener('pointerup',onUp);
   window.removeEventListener('blur',onUp);
   stage.removeEventListener('pointerdown',onDown);stage.removeEventListener('touchmove',onTouch);
   controls?.removeEventListener('click',onClick);
  };
 },[reduced]);
 if(reduced)return null;
 return h(SceneBoundary,null,h(Canvas,{
   camera:{position:[0,.3,9.1],fov:46,near:.1,far:55},
   dpr:[1,quality==='low'?1.35:1.85],
   gl:{antialias:quality!=='low',alpha:false,powerPreference:'high-performance'},
   onCreated:({gl})=>{
    gl.toneMapping=THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure=1.75;
    document.getElementById('cinematic-intro')?.classList.add('song-cinematic--ready');
   }
 },h(CinematicScene,{time,quality})));
}
const mount=document.getElementById('cinematic-canvas');
if(mount)createRoot(mount).render(h(Experience));
