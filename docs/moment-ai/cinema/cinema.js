/* MOMENT AI CINEMA navigation and integration with the existing same-origin app.
 * No private backend / Pleos SDK credentials are included.
 */
(() => {
  'use strict';
  const features={
    home:{name:'INTRO',no:'00',subtitle:'',desc:'',title:'',meta:''},
    music:{name:'MUSIC LOUNGE',no:'01',title:'YOUR<br><em>OWN</em><br>RHYTHM.',subtitle:'내가 만든 노래가 차 안의 풍경이 됩니다.',desc:'개인 음원을 재생하고 보관하는 기존 MOMENT AI 음악 플레이어를 그대로 연결했습니다. 음악 파일은 브라우저에 로컬 저장됩니다.',meta:'PERSONAL SOUNDTRACK'},
    journey:{name:'LIVING JOURNEY',no:'02',title:'GO<br><em>BEYOND</em><br>ROUTES.',subtitle:'움직이는 길 위에서, 새로운 이야기로.',desc:'목적지, 예상 주행시간, 공개 도로망 경유 계산과 지역 오디오 가이드를 연결한 기존 여정 화면입니다. Pleos 실차 값은 아직 검증 전입니다.',meta:'CONTEXT-AWARE MOBILITY'},
    lounge:{name:'DAILY INTELLIGENCE',no:'03',title:'A NEW<br><em>DAILY</em><br>RITUAL.',subtitle:'매일의 출발, 더 깊고 감각적으로.',desc:'국내 언론사 RSS로 업데이트되는 최신 뉴스 메타데이터와 실제 날씨 API, 음성 브리핑을 확인할 수 있습니다.',meta:'MORNING LOUNGE'},
    memory:{name:'JOURNEY MEMORY',no:'04',title:'MAKE<br>IT <em>LAST</em><br>FOREVER.',subtitle:'오늘의 음악과 하루를 하나의 기억으로.',desc:'사용자가 선택한 음악·제목·메모·기분을 로컬에서 기록하고, 저장·삭제·JSON 내보내기를 수행합니다.',meta:'YOUR DAYS, PRESERVED'},
    wellness:{name:'WELLNESS DINING',no:'05',title:'THE<br><em>WAY</em><br>YOU FEEL.',subtitle:'여정 속 나에게 어울리는 식사.',desc:'취향·식사 목표를 설정하고 공개 식당 위치·경로 데이터를 탐색합니다. 개인 건강기록 및 공식 미쉐린 데이터는 아직 연결되지 않았습니다.',meta:'DINING & DISCOVERY'},
    creative:{name:'CREATIVE STUDIO',no:'06',title:'CREATE<br><em>WHAT</em><br>MOVES.',subtitle:'떠오른 아이디어를 나만의 창작으로.',desc:'음악과 레시피 아이디어를 로컬에서 준비하는 화면입니다. WITHU·ChefOS의 비공개 엔진은 복제하거나 호출하지 않습니다.',meta:'FUTURE EXPERIENCES'}
  };
  const order=Object.keys(features);
  const $=id=>document.getElementById(id);
  const body=document.body;
  const hero=$('hero'),exp=$('experience'),frame=$('featureFrame'),shell=$('frameShell'),loading=$('frameLoading');
  let frameTimer=null;
  let screen='home',busy=false,scene=null,car=null,menuOpen=false,reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try{if(window.MomentScene)scene=new window.MomentScene($('world'));}catch(e){console.warn('Scene boot failed',e);}
  try{if(window.MomentCar)car=new window.MomentCar($('carWorld'));}catch(e){console.warn('Assembly scene unavailable',e);}
  $('renderStatus').textContent=car?'PROCEDURAL 3D ASSEMBLY':scene?.status||'VISUAL FALLBACK';
  const assemblySteps=[
    {english:'EVERY<br><span>JOURNEY.</span><br><i>YOUR MOMENT.</i>',label:'00 / THE BLUEPRINT',name:'모든 여정은 하나의 가능성에서 시작됩니다.',desc:'스크롤하거나 화면을 위로 밀어 모빌리티 공간을 만들어 보세요.',progress:0},
    {english:'FROM A<br><span>SINGLE</span><br><i>LINE.</i>',label:'01 / CHASSIS',name:'새로운 움직임의 뼈대.',desc:'섀시와 구조가 먼저 자리를 잡습니다.',progress:.22},
    {english:'MOTION<br><span>TAKES</span><br><i>FORM.</i>',label:'02 / MOTION',name:'움직임에 생명을 더하다.',desc:'바퀴가 결합되고 이동의 가능성이 구체화됩니다.',progress:.4},
    {english:'SHAPED<br><span>BY</span><br><i>DESIGN.</i>',label:'03 / FORM',name:'선과 면이 하나의 형태로.',desc:'외장 패널이 조립되며 자동차의 윤곽이 완성됩니다.',progress:.65},
    {english:'EVERY<br><span>DETAIL</span><br><i>MATTERS.</i>',label:'04 / CABIN',name:'나만의 공간이 만들어집니다.',desc:'유리와 실내 공간이 완성되고 마지막 디테일이 더해집니다.',progress:.88},
    {english:'YOUR<br><span>WORLD.</span><br><i>UNLOCKED.</i>',label:'05 / YOUR WORLD',name:'이제, 당신의 순간을 선택하세요.',desc:'음악·오늘의 정보·여정·웰니스·추억을 직접 선택해 들어가세요.',progress:1}
  ];
  const dots=$('assemblyDots');assemblySteps.forEach((s,i)=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label',`${i+1}번째 장면 ${s.label}`);b.addEventListener('click',()=>setAssemblyStep(i));dots.append(b);});
  let assemblyIndex=0,lastWheelAt=0,startTouch=null;
  function getStepFromURL(){const value=Number(new URLSearchParams(location.search).get('step'));return Number.isInteger(value)&&value>=0&&value<assemblySteps.length?value:0;}
  function setAssemblyStep(index,{fromHistory=false,replace=false}={}){
    assemblyIndex=Math.max(0,Math.min(assemblySteps.length-1,index));const s=assemblySteps[assemblyIndex];
    car?.setProgress(s.progress);$('heroTitle').innerHTML=s.english;body.classList.toggle('assembly-building',assemblyIndex>0&&assemblyIndex<assemblySteps.length-1);$('assemblyKicker').textContent=s.label;$('assemblyTitle').textContent=s.name;$('assemblyDescription').textContent=s.desc;$('assemblyStageLabel').textContent=s.label;
    $('assemblyPrev').disabled=assemblyIndex===0;$('assemblyNext').disabled=assemblyIndex===assemblySteps.length-1;
    [...dots.children].forEach((b,i)=>{if(i===assemblyIndex)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    const complete=assemblyIndex===assemblySteps.length-1;body.classList.toggle('assembly-complete',complete);$('assemblyFeatureDeck').hidden=!complete;
    $('scrollHint').textContent=complete?'SELECT A PERSONAL EXPERIENCE':'SCROLL / SWIPE TO BUILD ↓';
    if(!fromHistory){const u=new URL(location.href);u.searchParams.set('screen','home');u.searchParams.set('step',String(assemblyIndex));history[replace?'replaceState':'pushState']({screen:'home',step:assemblyIndex},'',u.pathname+u.search);}
  }
  function nextAssembly(dir){if(screen!=='home'||menuOpen||busy)return;if(dir>0&&assemblyIndex===assemblySteps.length-1)return;setAssemblyStep(assemblyIndex+(dir>0?1:-1));}
  $('assemblyNext').addEventListener('click',()=>nextAssembly(1));$('assemblyPrev').addEventListener('click',()=>nextAssembly(-1));
  function isInteractive(e){return !!e.target.closest('button,a,input,textarea,select,iframe,.full-menu,.chapter-nav');}
  document.addEventListener('wheel',e=>{if(screen!=='home'||menuOpen||isInteractive(e))return;if(Math.abs(e.deltaY)<8)return;e.preventDefault();const now=performance.now();if(now-lastWheelAt<620)return;lastWheelAt=now;nextAssembly(e.deltaY>0?1:-1);},{passive:false});
  const heroTouch=$('hero');heroTouch.addEventListener('touchstart',e=>{if(screen!=='home'||isInteractive(e)||e.touches.length!==1)return;startTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
  heroTouch.addEventListener('touchend',e=>{if(!startTouch||!e.changedTouches.length)return;const dx=e.changedTouches[0].clientX-startTouch.x,dy=e.changedTouches[0].clientY-startTouch.y;startTouch=null;if(Math.abs(dy)>46&&Math.abs(dy)>Math.abs(dx)*1.2)nextAssembly(dy<0?1:-1);else if(Math.abs(dx)>35)car?.rotate(dx*.002);else if(Math.abs(dx)<12&&Math.abs(dy)<12)nextAssembly(1);},{passive:true});
  let dragStart=null;heroTouch.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&!isInteractive(e))dragStart=e.clientX;});heroTouch.addEventListener('pointerup',e=>{if(dragStart===null)return;const dx=e.clientX-dragStart;dragStart=null;if(Math.abs(dx)>20)car?.rotate(dx*.003);});
  const resetAssemblyToHistory=()=>setAssemblyStep(getStepFromURL(),{fromHistory:true});
  function embedApp(name){
    const target=new URL('../',document.baseURI);target.searchParams.set('screen',name);
    shell.classList.remove('ready','failed');$('frameError').hidden=true;loading.hidden=false;if(frameTimer)clearTimeout(frameTimer);frameTimer=setTimeout(()=>showFrameError(),14000);frame.title=`MOMENT AI — ${features[name].name}`;
    const desired=target.toString();if(frame.src!==desired)frame.src=desired;else {shell.classList.add('ready');loading.hidden=true;}
    $('openFullApp').href=desired;$('frameErrorLink').href=desired;
  }
  function showFrameError(){shell.classList.add('failed');loading.hidden=true;$('frameError').hidden=false;}
  frame.addEventListener('load',()=>{
    if(frame.src==='about:blank')return;
    let confirmed=false;
    try{
      const doc=frame.contentDocument;
      if(doc?.head && (doc.getElementById('music') || doc.getElementById('journey') || doc.getElementById('lounge'))){
        confirmed=true;
        let style=doc.getElementById('moment-cinema-embed-style');
        if(!style){style=doc.createElement('style');style.id='moment-cinema-embed-style';doc.head.append(style);}
        style.textContent=`
          html,body{max-width:100%!important;overflow-x:hidden!important;scroll-behavior:auto!important}
          header.topbar,#appPageMenu,.app-page-menu,.mobile-bottom-nav,.bottom-nav,.home-module-nav,.page-glow{display:none!important}
          body{padding-top:0!important}
          .section.screen-view{padding:18px 20px 34px!important;margin:0 auto!important;min-height:0!important}
          .section-header{margin-top:0!important;padding-top:0!important}
          .music-grid,.journey-grid,.briefing-grid{gap:13px!important}
          @media(max-width:600px){.section.screen-view{padding:15px 12px 30px!important}}
        `;
        const audio=doc.getElementById('personalAudio');
        if(audio && !audio.dataset.momentCinemaTracked){
          audio.dataset.momentCinemaTracked='1';
          audio.addEventListener('play',()=>scene?.setPlaying(true));
          ['pause','ended'].forEach(ev=>audio.addEventListener(ev,()=>scene?.setPlaying(false)));
        }
      }
    }catch(err){console.info('Embedded app styles unavailable; app remains functional',err);}
    if(frameTimer){clearTimeout(frameTimer);frameTimer=null;}
    if(confirmed){shell.classList.add('ready');loading.hidden=true;}else showFrameError();
  });
  function pageFromURL(){const s=new URLSearchParams(location.search).get('screen');return order.includes(s)?s:'home';}
  function setMenu(open){menuOpen=!!open;$('fullMenu').hidden=!menuOpen;$('menuToggle').setAttribute('aria-expanded',String(menuOpen));}
  function syncNav(){document.querySelectorAll('[data-go]').forEach(b=>{const active=b.dataset.go===screen&&b.classList.contains('chapter');b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
  function showPage(next){
    screen=next;body.dataset.screen=next;
    scene?.setScreen(next);car?.setActive(next==='home');
    const isHome=next==='home';hero.hidden=!isHome;exp.hidden=isHome;
    if(isHome){resetAssemblyToHistory();}
    if(!isHome){
      const f=features[next];$('experienceTitle').innerHTML=f.title;$('experienceSubtitle').textContent=f.subtitle;$('experienceDescription').textContent=f.desc;$('featureMeta').textContent=f.meta;$('featureNumber').textContent=`${String(order.indexOf(next)+1).padStart(2,'0')} / 07`;$('experienceIndex').textContent=f.no;$('frameCaption').textContent=`${f.name} / FUNCTIONAL MODULE`;
      embedApp(next);
    } else{scene?.setPlaying(false);if(frame.src!=='about:blank'){try{frame.contentDocument?.getElementById('personalAudio')?.pause();}catch(e){}}}
    syncNav();setMenu(false);document.title=`${isHome?'MOMENT AI':fDisplay(next)+' · MOMENT AI'} — Beyond the Drive`;
  }
  function fDisplay(s){return features[s]?.name||'MOMENT AI';}
  function navigate(next,{replace=false,instant=false}={}){
    if(!order.includes(next))next='home';if(busy)return;if(next===screen&&!replace)return;
    const url=new URL(location.href);url.searchParams.set('screen',next);url.hash='';
    if(next==='home'){url.searchParams.set('step',String(assemblyIndex));}else{url.searchParams.delete('step');}
    if(replace)history.replaceState({screen:next},'',url.pathname+url.search);else history.pushState({screen:next},'',url.pathname+url.search);
    setMenu(false);
    if(instant||reduce){showPage(next);return;}
    busy=true;body.classList.add('is-travelling');scene?.travel();
    window.setTimeout(()=>{showPage(next);body.classList.remove('is-travelling');busy=false;},500);
  }
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
  $('brand').addEventListener('click',e=>{e.preventDefault();navigate('home');});
  $('menuToggle').addEventListener('click',()=>setMenu(!menuOpen));
  $('motionToggle').addEventListener('click',()=>{reduce=!reduce;body.classList.toggle('reduced-motion',reduce);scene?.setReduced(reduce);car?.setReduced(reduce);$('motionToggle').textContent=reduce?'▶':'Ⅱ';$('motionToggle').setAttribute('aria-label',reduce?'움직임 켜기':'움직임 줄이기');});
  $('reloadFrame').addEventListener('click',()=>{if(screen!=='home'){shell.classList.remove('ready','failed');$('frameError').hidden=true;loading.hidden=false;frame.src=new URL(`../?screen=${encodeURIComponent(screen)}&refresh=${Date.now()}`,location.href).toString();}});
  const list=$('menuList');order.forEach((s,i)=>{const item=document.createElement('button');item.type='button';item.dataset.menuScreen=s;item.innerHTML=`<small>${String(i).padStart(2,'0')}</small><span>${features[s].name}</span>`;item.addEventListener('click',()=>navigate(s));list.append(item);});
  window.addEventListener('popstate',()=>{busy=false;body.classList.remove('is-travelling');showPage(pageFromURL());});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen){setMenu(false);$('menuToggle').focus();return;}const active=document.activeElement;if(active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName))return;if(menuOpen)return;if(screen==='home'&&['ArrowDown','PageDown'].includes(e.key)){e.preventDefault();nextAssembly(1);return;}if(screen==='home'&&['ArrowUp','PageUp'].includes(e.key)){e.preventDefault();nextAssembly(-1);return;}if(e.key==='ArrowRight'&&e.altKey){navigate(order[(order.indexOf(screen)+1)%order.length]);}if(e.key==='ArrowLeft'&&e.altKey){navigate(order[(order.indexOf(screen)-1+order.length)%order.length]);}});
  const initial=pageFromURL();showPage(initial);car?.setReduced(reduce);body.classList.toggle('reduced-motion',reduce);
  if(initial==='home' && !new URLSearchParams(location.search).has('screen'))history.replaceState({screen:'home'},'',location.pathname+'?screen=home');
  window.MOMENT_CINEMA_TEST={getScreen:()=>screen,go:s=>navigate(s,{instant:true}),getFrameUrl:()=>frame.src,get3DStatus:()=>car?'PROCEDURAL 3D':scene?.status||'FALLBACK',getAssemblyStep:()=>assemblyIndex,assemblyNext:()=>nextAssembly(1),assemblyPrev:()=>nextAssembly(-1),getAssemblyProgress:()=>car?.target};
})();