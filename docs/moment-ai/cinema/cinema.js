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
  let screen='home',busy=false,scene=null,menuOpen=false,reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try{if(window.MomentScene)scene=new window.MomentScene($('world'));}catch(e){console.warn('Scene boot failed',e);}
  $('renderStatus').textContent=scene?.status||'VISUAL FALLBACK';
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
    scene?.setScreen(next);
    const isHome=next==='home';hero.hidden=!isHome;exp.hidden=isHome;
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
    if(replace)history.replaceState({screen:next},'',url.pathname+url.search);else history.pushState({screen:next},'',url.pathname+url.search);
    setMenu(false);
    if(instant||reduce){showPage(next);return;}
    busy=true;body.classList.add('is-travelling');scene?.travel();
    window.setTimeout(()=>{showPage(next);body.classList.remove('is-travelling');busy=false;},500);
  }
  document.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.go)));
  $('brand').addEventListener('click',e=>{e.preventDefault();navigate('home');});
  $('menuToggle').addEventListener('click',()=>setMenu(!menuOpen));
  $('motionToggle').addEventListener('click',()=>{reduce=!reduce;body.classList.toggle('reduced-motion',reduce);scene?.setReduced(reduce);$('motionToggle').textContent=reduce?'▶':'Ⅱ';$('motionToggle').setAttribute('aria-label',reduce?'움직임 켜기':'움직임 줄이기');});
  $('reloadFrame').addEventListener('click',()=>{if(screen!=='home'){shell.classList.remove('ready','failed');$('frameError').hidden=true;loading.hidden=false;frame.src=new URL(`../?screen=${encodeURIComponent(screen)}&refresh=${Date.now()}`,location.href).toString();}});
  const list=$('menuList');order.forEach((s,i)=>{const item=document.createElement('button');item.type='button';item.dataset.menuScreen=s;item.innerHTML=`<small>${String(i).padStart(2,'0')}</small><span>${features[s].name}</span>`;item.addEventListener('click',()=>navigate(s));list.append(item);});
  window.addEventListener('popstate',()=>{busy=false;body.classList.remove('is-travelling');showPage(pageFromURL());});
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen){setMenu(false);$('menuToggle').focus();return;}const active=document.activeElement;if(active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName))return;if(menuOpen)return;if(e.key==='ArrowRight'&&e.altKey){navigate(order[(order.indexOf(screen)+1)%order.length]);}if(e.key==='ArrowLeft'&&e.altKey){navigate(order[(order.indexOf(screen)-1+order.length)%order.length]);}});
  const initial=pageFromURL();showPage(initial);body.classList.toggle('reduced-motion',reduce);
  if(initial==='home' && !new URLSearchParams(location.search).has('screen'))history.replaceState({screen:'home'},'',location.pathname+'?screen=home');
  window.MOMENT_CINEMA_TEST={getScreen:()=>screen,go:s=>navigate(s,{instant:true}),getFrameUrl:()=>frame.src,get3DStatus:()=>scene?.status||'FALLBACK'};
})();