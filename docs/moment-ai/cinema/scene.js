/* MOMENT AI CINEMA — original procedural WebGL2 scene. No proprietary 3D assets or SDK. */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const identity = () => new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const multiply = (a,b) => { const out=new Float32Array(16); for(let j=0;j<4;j++)for(let i=0;i<4;i++){let s=0;for(let k=0;k<4;k++)s+=a[k*4+i]*b[j*4+k];out[j*4+i]=s;}return out; };
  const translation=(x,y,z)=>{const m=identity();m[12]=x;m[13]=y;m[14]=z;return m;};
  const scale=(x,y,z)=>{const m=identity();m[0]=x;m[5]=y;m[10]=z;return m;};
  const rotateX=a=>{const m=identity(),c=Math.cos(a),s=Math.sin(a);m[5]=c;m[6]=s;m[9]=-s;m[10]=c;return m;};
  const rotateY=a=>{const m=identity(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[2]=-s;m[8]=s;m[10]=c;return m;};
  const rotateZ=a=>{const m=identity(),c=Math.cos(a),s=Math.sin(a);m[0]=c;m[1]=s;m[4]=-s;m[5]=c;return m;};
  const perspective=(fov,aspect,n,f)=>{const t=1/Math.tan(fov/2),m=new Float32Array(16);m[0]=t/aspect;m[5]=t;m[10]=(f+n)/(n-f);m[11]=-1;m[14]=2*f*n/(n-f);return m;};
  const meshFrom=(ringRadius,tubeRadius,around=96,along=24) => {
    const vertices=[],indices=[];
    for(let i=0;i<=around;i++)for(let j=0;j<=along;j++){
      const a=i/around*TAU,b=j/along*TAU,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
      vertices.push((ringRadius+tubeRadius*cb)*ca,(ringRadius+tubeRadius*cb)*sa,tubeRadius*sb,cb*ca,cb*sa,sb);
    }
    for(let i=0;i<around;i++)for(let j=0;j<along;j++){const a=i*(along+1)+j,b=a+along+1;indices.push(a,b,a+1,b,b+1,a+1);}
    return {vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  };
  const sphere=(rings=56,slices=84) => {
    const vertices=[],indices=[];
    for(let i=0;i<=rings;i++)for(let j=0;j<=slices;j++){
      const a=i/rings*Math.PI,b=j/slices*TAU,sa=Math.sin(a),ca=Math.cos(a),cb=Math.cos(b),sb=Math.sin(b),x=sa*cb,y=ca,z=sa*sb;
      vertices.push(x,y,z,x,y,z);
    }
    for(let i=0;i<rings;i++)for(let j=0;j<slices;j++){const a=i*(slices+1)+j,b=a+slices+1;indices.push(a,a+1,b,a+1,b+1,b);}
    return {vertices:new Float32Array(vertices),indices:new Uint16Array(indices)};
  };
  const VERT=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNormal;
  uniform mat4 uModel; uniform mat4 uVP;
  out vec3 vN; out vec3 vP;
  void main(){vec4 wp=uModel*vec4(aPos,1.);vP=wp.xyz;vN=mat3(uModel)*aNormal;gl_Position=uVP*wp;}`;
  const FRAG=`#version 300 es
  precision highp float;
  in vec3 vN; in vec3 vP; uniform vec3 uEye;uniform float uTime;uniform float uGold;uniform float uFade;
  out vec4 fragColor;
  float ridge(float x,float k){return pow(max(x,0.),k);}
  void main(){
    vec3 N=normalize(vN), V=normalize(uEye-vP), R=reflect(-V,N);
    float ndv=clamp(dot(N,V),0.,1.);
    vec3 a=normalize(vec3(-0.6,0.8,1.5)), b=normalize(vec3(0.7,0.25,1.0)), c=normalize(vec3(0.2,-0.8,0.5));
    float s1=ridge(dot(R,a),28.)*2.3, s2=ridge(dot(R,b),8.)*0.8, s3=ridge(dot(R,c),30.)*1.2;
    float environment=smoothstep(-.55,.8,R.y)*.33;
    float linearStripe=ridge(1.-abs(R.x*.95+R.y*.2+.24),14.)*.8;
    float upperStripe=ridge(1.-abs(R.y*.75-R.z*.34-.33),21.)*1.2;
    vec3 base=mix(vec3(.04,.08,.11),vec3(.34,.41,.49),environment);
    base += vec3(.62,.71,.83)*(s1+s2*.5+linearStripe*.7+upperStripe*.7);
    base += vec3(.38,.46,.59)*s3;
    float fres=pow(1.-ndv,3.1);
    base+=vec3(.61,.76,.91)*fres*.8;
    vec3 gold=vec3(1.0,.66,.36);
    base=mix(base,vec3(.055,.043,.035)+base*gold*1.35,uGold);
    base=base/(vec3(1.0)+base*.6);
    base=pow(base,vec3(.89));
    fragColor=vec4(base,uFade);
  }`;
  const DOT_VERT=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;uniform mat4 uVP;uniform float uTime;out float vA;
  void main(){gl_Position=uVP*vec4(aPos,1.);gl_PointSize=clamp(1.5+8./gl_Position.w,1.5,4.);vA=0.25+0.55*abs(sin(uTime*.21+aPos.x*2.1));}`;
  const DOT_FRAG=`#version 300 es
  precision highp float;
  in float vA;out vec4 outColor;
  void main(){float d=length(gl_PointCoord-.5);float a=smoothstep(.5,0.,d)*vA;outColor=vec4(.63,.73,.83,a);}`;
  class MomentScene {
    constructor(canvas){this.canvas=canvas;this.mobile=matchMedia('(max-width: 760px)');this.motion=matchMedia('(prefers-reduced-motion: reduce)').matches?0:1;this.screen='home';this.offset=0;this.offsetTarget=0;this.spin=0;this.targetSpin=0;this.pitch=0;this.targetPitch=0;this.enterPulse=0;this.liveMusic=false;this.lastTime=0;this.running=true;
      this.gl=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'high-performance',premultipliedAlpha:false});
      if(this.gl){try{this.initGL();this.status='REAL-TIME WEBGL2';}catch(e){console.warn('MOMENT WebGL2 unavailable:',e);this.status='STATIC FALLBACK';this.gl=null;}}
      else this.status='STATIC FALLBACK';
      if(!this.gl)this.initFallback();
      this.resize();window.addEventListener('resize',()=>this.resize(),{passive:true});
      this.setupPointer();document.addEventListener('visibilitychange',()=>{this.running=!document.hidden;if(this.running){this.lastTime=0;requestAnimationFrame(t=>this.frame(t));}});
      requestAnimationFrame(t=>this.frame(t));
    }
    compile(type,source){const g=this.gl,s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s));return s;}
    program(v,f){const g=this.gl,p=g.createProgram();g.attachShader(p,this.compile(g.VERTEX_SHADER,v));g.attachShader(p,this.compile(g.FRAGMENT_SHADER,f));g.linkProgram(p);if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p));return p;}
    upload(geo){const g=this.gl,vao=g.createVertexArray();g.bindVertexArray(vao);const v=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,v);g.bufferData(g.ARRAY_BUFFER,geo.vertices,g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,3,g.FLOAT,false,24,0);g.enableVertexAttribArray(1);g.vertexAttribPointer(1,3,g.FLOAT,false,24,12);const ib=g.createBuffer();g.bindBuffer(g.ELEMENT_ARRAY_BUFFER,ib);g.bufferData(g.ELEMENT_ARRAY_BUFFER,geo.indices,g.STATIC_DRAW);g.bindVertexArray(null);return {vao,count:geo.indices.length};}
    initGL(){const g=this.gl;this.metalProgram=this.program(VERT,FRAG);this.dotProgram=this.program(DOT_VERT,DOT_FRAG);this.u={model:g.getUniformLocation(this.metalProgram,'uModel'),vp:g.getUniformLocation(this.metalProgram,'uVP'),eye:g.getUniformLocation(this.metalProgram,'uEye'),time:g.getUniformLocation(this.metalProgram,'uTime'),gold:g.getUniformLocation(this.metalProgram,'uGold'),fade:g.getUniformLocation(this.metalProgram,'uFade')};this.du={vp:g.getUniformLocation(this.dotProgram,'uVP'),time:g.getUniformLocation(this.dotProgram,'uTime')};this.core=this.upload(sphere());this.arc1=this.upload(meshFrom(2.08,.075));this.arc2=this.upload(meshFrom(2.4,.029));this.arc3=this.upload(meshFrom(1.7,.033));this.arc4=this.upload(meshFrom(2.7,.013));let seed=73814;const random=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};const points=[];for(let i=0;i<280;i++){const angle=random()*TAU,dist=4+random()*14;points.push(Math.cos(angle)*dist,(random()-.5)*12,Math.sin(angle)*dist-2);}this.pointCount=points.length/3;this.pointVAO=g.createVertexArray();g.bindVertexArray(this.pointVAO);const p=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,p);g.bufferData(g.ARRAY_BUFFER,new Float32Array(points),g.STATIC_DRAW);g.enableVertexAttribArray(0);g.vertexAttribPointer(0,3,g.FLOAT,false,12,0);g.bindVertexArray(null);g.enable(g.DEPTH_TEST);g.disable(g.CULL_FACE);g.clearColor(0,0,0,0);}
    initFallback(){
      // Animated, CPU-rendered real 3D geometry for browsers blocking WebGL2.
      // This is not a static preview: transformed 3D torus coordinates are projected every frame.
      this.ctx=this.canvas.getContext('2d',{alpha:true});
      this.status=this.ctx?'SOFTWARE 3D':'VISUAL FALLBACK';
    }
    renderCanvas(time){
      const ctx=this.ctx;if(!ctx)return;
      const W=this.width,H=this.height,mobile=this.mobile.matches;
      ctx.clearRect(0,0,W,H);
      const dpr=Math.min(window.devicePixelRatio||1,mobile?1.35:1.75);
      const cx=W*(mobile?.61:(this.screen==='home'?.775:.78));
      const cy=H*(mobile?.51:.48);
      const radius=Math.min(W*(mobile?.36:.172),H*.35);
      const rotation=(this.spin+time*this.motion*(this.liveMusic?.35:.13)),pitch=this.pitch;
      const cY=Math.cos(rotation),sY=Math.sin(rotation),cX=Math.cos(pitch),sX=Math.sin(pitch);
      const turn=(x,y,z)=>{
        const ax=x*cY+z*sY,az=-x*sY+z*cY;
        return [ax,y*cX-az*sX,y*sX+az*cX];
      };
      const project=(x,y,z)=>{const perspective=5.7/(5.7-z*.26);return[cx+x*radius*.9*perspective,cy+y*radius*.9*perspective,perspective];};
      const points=[];
      for(let k=0;k<4;k++){
        const r=[1.88,2.12,2.52,1.46][k],tilt=[.95,.17,1.32,.54][k],side=[.36,1.07,-.42,.7][k];
        const cT=Math.cos(tilt),sT=Math.sin(tilt),cS=Math.cos(side),sS=Math.sin(side);
        const n=132;
        for(let i=0;i<n;i++){
          const a=i/n*TAU,b=(i+1)/n*TAU;
          const vec=t=>{const x=Math.cos(t)*r,y=Math.sin(t)*r;const aX=x*cS,aZ=x*sS;return turn(aX,y*cT-aZ*sT,y*sT+aZ*cT);};
          const P=vec(a),Q=vec(b),p=project(...P),q=project(...Q);
          points.push({p,q,z:(P[2]+Q[2])*.5,k});
        }
      }
      // Order segments back to front. The orb occludes rear geometry.
      const rear=points.filter(p=>p.z<=.15).sort((a,b)=>a.z-b.z);
      const front=points.filter(p=>p.z>.15).sort((a,b)=>a.z-b.z);
      const drawSegs=(arr)=>{for(const {p,q,z,k} of arr){
        const metal=clamp((z+2.5)/5,0,1),shine=clamp(Math.sin(z*2.1+time*.18+k*2.3)*.22+.28,0,.55);
        const gold=k===1;
        const alpha=(.15+metal*.48+shine*.12).toFixed(3);
        ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);
        ctx.lineWidth=clamp(radius*[.027,.013,.008,.015][k]*p[2],1.5,6);
        ctx.strokeStyle=gold?`rgba(235,207,164,${alpha})`:`rgba(178,207,242,${alpha})`;
        ctx.stroke();
      }};
      ctx.save();ctx.globalCompositeOperation='screen';drawSegs(rear);ctx.restore();
      const x=cx,y=cy,r=radius*.99;
      const glow=ctx.createRadialGradient(x,y,r*.2,x,y,r*1.65);
      glow.addColorStop(0,'rgba(146,168,203,.10)');glow.addColorStop(.7,'rgba(70,91,124,.065)');glow.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,r*1.65,0,TAU);ctx.fill();
      const orb=ctx.createRadialGradient(x-r*.46,y-r*.58,r*.04,x+r*.13,y+r*.08,r*1.19);
      orb.addColorStop(0,'#dee1df');orb.addColorStop(.13,'#9da9b9');orb.addColorStop(.27,'#424f68');orb.addColorStop(.47,'#152132');orb.addColorStop(.76,'#080e18');orb.addColorStop(.94,'#354b61');orb.addColorStop(1,'#aab7bd');
      ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fillStyle=orb;ctx.fill();
      ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.clip();
      const stripe=ctx.createLinearGradient(x-r,y-r*.8,x+r,y+r*.8);
      stripe.addColorStop(0,'rgba(0,0,0,0)');stripe.addColorStop(.25,'rgba(234,242,252,.08)');stripe.addColorStop(.43,'rgba(252,251,249,.36)');stripe.addColorStop(.5,'rgba(243,246,247,.02)');stripe.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle=stripe;ctx.save();ctx.translate(x,y);ctx.rotate(-.55+rotation*.12);ctx.fillRect(-r*1.5,-r*1.5,r*3,r*3);ctx.restore();
      ctx.restore();ctx.lineWidth=1;ctx.strokeStyle='rgba(224,235,250,.33)';ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.stroke();
      ctx.save();ctx.globalCompositeOperation='screen';drawSegs(front);ctx.restore();
      const grainCount=26;ctx.fillStyle='rgba(200,213,229,.24)';
      for(let i=0;i<grainCount;i++){const a=i*2.39996,s=2.6+((i*37)%17)/7,d=radius*s;const px=x+Math.cos(a+time*.011)*d,py=y+Math.sin(a*.88)*d*.75;if(px>0&&px<W&&py>0&&py<H)ctx.fillRect(px,py,1.1,1.1);}
    }
    setupPointer(){let down=false,lastX=0,lastY=0;const el=this.canvas;el.addEventListener('pointerdown',e=>{down=true;lastX=e.clientX;lastY=e.clientY;el.setPointerCapture?.(e.pointerId);});el.addEventListener('pointerup',()=>down=false);el.addEventListener('pointercancel',()=>down=false);el.addEventListener('pointermove',e=>{if(!down||!this.motion)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;this.targetSpin=clamp(this.targetSpin+dx*.008,-2.1,2.1);this.targetPitch=clamp(this.targetPitch+dy*.005,-.7,.7);});}
    resize(){const dpr=Math.min(window.devicePixelRatio||1,this.mobile.matches?1.35:1.75);const rect=this.canvas.getBoundingClientRect();this.width=Math.max(1,Math.round(rect.width*dpr));this.height=Math.max(1,Math.round(rect.height*dpr));this.canvas.width=this.width;this.canvas.height=this.height;if(this.gl)this.gl.viewport(0,0,this.width,this.height);}
    setScreen(s){this.screen=s;this.offsetTarget=s==='home'?0:1;this.targetPitch=s==='journey'?.1:s==='music'?-.12:0;this.enterPulse=1;}
    travel(){this.enterPulse=1.6;this.targetSpin+=.48;}
    setReduced(yes){this.motion=yes?0:1;if(yes)this.spin=this.targetSpin=0;}
    setPlaying(playing){this.liveMusic=playing;}
    frame(t){if(!this.running)return;const dt=Math.min(.1,(t-(this.lastTime||t))/1000);this.lastTime=t;const a=this.motion?Math.min(1,dt*2.6):1;this.offset+=(this.offsetTarget-this.offset)*a;this.spin+=(this.targetSpin-this.spin)*a;this.pitch+=(this.targetPitch-this.pitch)*a;this.enterPulse=Math.max(0,this.enterPulse-dt*2.1);if(this.gl)this.render(t*.001);else this.renderCanvas(t*.001);requestAnimationFrame(n=>this.frame(n));}
    render(time){const g=this.gl;g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);const ratio=this.width/this.height;const proj=perspective(Math.PI/4.5,ratio,.1,140);const mobile=this.mobile.matches;const cx=mobile?.64:(this.screen==='home'?2.1:1.55);const cameraDist=(mobile?10.3:9.2)-this.enterPulse*.65;const view=translation(0,0,-cameraDist);const vp=multiply(proj,view);const speed=(this.liveMusic?1.32:.35)*this.motion;const timeRot=time*speed*.24;g.useProgram(this.dotProgram);g.uniformMatrix4fv(this.du.vp,false,vp);g.uniform1f(this.du.time,time);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE);g.depthMask(false);g.bindVertexArray(this.pointVAO);g.drawArrays(g.POINTS,0,this.pointCount);g.depthMask(true);g.disable(g.BLEND);
      const parent=multiply(translation(cx,0,-1.8-this.offset*.4),multiply(rotateY(.22+this.spin+timeRot),rotateX(-.12+this.pitch)));
      const eye=[0,0,cameraDist];g.useProgram(this.metalProgram);g.uniformMatrix4fv(this.u.vp,false,vp);g.uniform3fv(this.u.eye,eye);g.uniform1f(this.u.time,time);g.uniform1f(this.u.fade,1);
      const draw=(mesh,model,gold)=>{g.uniformMatrix4fv(this.u.model,false,model);g.uniform1f(this.u.gold,gold);g.bindVertexArray(mesh.vao);g.drawElements(g.TRIANGLES,mesh.count,g.UNSIGNED_SHORT,0);};
      const coreModel=multiply(parent,multiply(rotateY(timeRot*.25),scale(1.17,1.17,1.17)));draw(this.core,coreModel,.04);
      draw(this.arc1,multiply(parent,multiply(rotateX(.9+timeRot*.23),rotateY(.4))),.12);
      draw(this.arc2,multiply(parent,multiply(rotateX(.2),rotateY(1.1+timeRot*.55))),.75);
      draw(this.arc3,multiply(parent,multiply(rotateX(1.2+timeRot*.33),rotateY(-.42))),.18);
      draw(this.arc4,multiply(parent,multiply(rotateY(.55+timeRot*.62),rotateX(.4))),.0);
      g.bindVertexArray(null);
    }
  }
  window.MomentScene=MomentScene;
})();