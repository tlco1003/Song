/* WITHU public landing page — static media player and consented video gallery.
 * No API keys or private files are uploaded by this script.
 * Github Pages cannot persist visitor files; local previews are ephemeral. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const knownFallback = [
    {id:'song-nara',title:'나라는 사람',subtitle:'삶과 사랑을 돌아보는 노래',file:'nara.mp3',durationSeconds:257.544,sunoId:'6723268c-9e91-4647-a8da-ed06d6b32b8c'},
    {id:'song-taehwan',title:'구태환에게',subtitle:'연인에게 보내는 편지 같은 노래',file:'taehwan.mp3',durationSeconds:320.04,sunoId:'98a47c4c-ad1b-4bff-8f21-8afb55a4278a'},
    {id:'song-jeongmi',title:'내사랑김정미',subtitle:'소중한 친구에게 보내는 선물',file:'jeongmi.mp3',durationSeconds:350.04,sunoId:'f2f182c2-06e1-4c2d-927f-d26dfac7243b'}
  ];
  const state = {tracks:[],current:0,localUrls:[],videoUrls:[],online:true};
  const audio=$('withu-audio'), embed=$('withu-suno-embed');
  const extRe=/\.(mp3|m4a|wav|ogg)$/i;
  const videoRe=/\.(mp4|webm)$/i;

  const canUseGithub = u => typeof u==='string' && /^https:\/\/github\.com\/tlco1003\/Song\/upload\/main\/docs\/(?:media|reviews)$/.test(u);
  const formatTime = s => {const n=Math.round(s||0);return Math.floor(n/60)+':'+String(n%60).padStart(2,'0')};
  const displayName = value => value.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ').slice(0,100);
  function status(message) {$('withu-player-status').textContent=message;}
  function showMediaMode(type){
    audio.hidden=type!=='audio';
    $('withu-embed-wrap').hidden=type!=='embed';
    $('withu-no-media').hidden=type!=='none';
  }
  function register(track) {
    if(!state.tracks.some(t=>t.id===track.id||t.file&&t.file===track.file))state.tracks.push(track);
  }
  async function exists(url){
    try {
      const response=await fetch(url,{method:'HEAD',cache:'no-store'});
      return response.ok;
    }catch(_){return false;}
  }
  async function loadTracks() {
    let seed=knownFallback;
    try {
      const r=await fetch('media/tracks.json',{cache:'no-store'});
      if(r.ok){const json=await r.json();if(Array.isArray(json.tracks)&&json.tracks.length)seed=json.tracks;}
    }catch(_){}
    seed.filter(t=>t&&typeof t.title==='string'&&typeof t.file==='string')
      .forEach(t=>register({...t,local:false,published:false}));
    await Promise.all(state.tracks.map(async t=>{
      t.published=await exists('media/'+encodeURIComponent(t.file));
    }));
    // Public GitHub contents lists any additional music published by the owner,
    // so new songs need not be hard-coded into this static web page.
    try{
      const r=await fetch('https://api.github.com/repos/tlco1003/Song/contents/docs/media',{cache:'no-store'});
      if(r.ok){
        const files=await r.json();
        if(Array.isArray(files)){
          for(const f of files.filter(f=>f.type==='file'&&extRe.test(f.name)&&f.size<100*1024*1024)){
            const existing=state.tracks.find(t=>t.file===f.name);
            if(existing){existing.published=await exists('media/'+encodeURIComponent(f.name));continue;}
            register({id:'gh-'+f.sha,title:displayName(f.name),subtitle:'WITHU에 게시된 노래',file:f.name,published:await exists('media/'+encodeURIComponent(f.name)),local:false});
          }
        }
      }
    }catch(_){}
    renderTrackList();
    selectTrack(0);
  }
  function selectTrack(index,autoplay=false){
    if(!state.tracks.length)return;
    state.current=(index+state.tracks.length)%state.tracks.length;
    const t=state.tracks[state.current];
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    embed.src='about:blank';
    $('withu-track-title').textContent=t.title;
    $('withu-track-subtitle').textContent=t.subtitle||'소중한 이야기를 담은 노래';
    $('withu-track-position').textContent=String(state.current+1).padStart(2,'0')+' / '+String(state.tracks.length).padStart(2,'0');
    $('withu-track-duration').textContent=t.durationSeconds?formatTime(t.durationSeconds):'';
    if(t.local||t.published){
      audio.src=t.local?t.localUrl:'media/'+encodeURIComponent(t.file);
      audio.load();
      showMediaMode('audio');
      status(t.local?'선택한 음악을 이 기기에서 미리 듣고 있어요. 아직 공개 게시된 파일은 아닙니다.':'공개된 음악 파일을 바로 재생할 수 있어요.');
      if(autoplay)audio.play().catch(()=>status('다음 곡을 재생하려면 재생 버튼을 눌러주세요.'));
    }else if(t.sunoId&&/^[a-f0-9-]{36}$/.test(t.sunoId)){
      embed.src='https://suno.com/embed/'+t.sunoId;
      showMediaMode('embed');
      status('Suno 원본 플레이어입니다. ▶ 버튼으로 재생해 주세요. 계정 공개 설정에 따라 재생이 제한될 수 있어요.');
    }else{
      showMediaMode('none');
      $('withu-no-media').textContent='아직 공개 음원 파일이 업로드되지 않았어요.';
      status('게시된 MP3가 확인되지 않았습니다.');
    }
    const originalLink=$('withu-open-suno');
    const canOpen=!!(t.sunoId&&/^[a-f0-9-]{36}$/.test(t.sunoId));
    originalLink.hidden=!canOpen;
    if(canOpen)originalLink.href='https://suno.com/song/'+t.sunoId;
    Array.from($('withu-track-list').querySelectorAll('[data-track-index]')).forEach(button=>{
      const active=Number(button.dataset.trackIndex)===state.current;
      button.classList.toggle('active',active);
      button.setAttribute('aria-current',active?'true':'false');
    });
  }
  function renderTrackList(){
    const list=$('withu-track-list');list.textContent='';
    state.tracks.forEach((t,i)=>{
      const button=document.createElement('button');
      button.type='button';button.className='withu-track-option';button.dataset.trackIndex=String(i);
      const number=document.createElement('span');number.className='withu-track-number';number.textContent=String(i+1).padStart(2,'0');
      const info=document.createElement('span');info.className='withu-track-detail';
      const title=document.createElement('strong');title.textContent=t.title;
      const desc=document.createElement('small');desc.textContent=t.local?'내 기기에서 선택한 파일':(t.published?'파일 재생 가능':t.sunoId?'Suno 원본 연결':'업로드 전');
      info.append(title,desc);
      const time=document.createElement('span');time.className='withu-track-time';time.textContent=t.durationSeconds?formatTime(t.durationSeconds):'♪';
      button.append(number,info,time);
      button.addEventListener('click',()=>selectTrack(i));
      list.appendChild(button);
    });
  }
  function onLocalSongUpload(event){
    const files=Array.from(event.target.files||[]);
    if(!files.length)return;
    let accepted=0;
    for(const file of files){
      if(!extRe.test(file.name)||file.size>100*1024*1024)continue;
      const url=URL.createObjectURL(file);
      state.localUrls.push(url);
      register({id:'local-'+Date.now()+'-'+accepted,title:displayName(file.name),subtitle:'이 기기에서만 미리 듣기',file:file.name,local:true,localUrl:url,published:false});
      accepted++;
    }
    renderTrackList();
    if(accepted)selectTrack(state.tracks.length-accepted);
    $('withu-upload-note').textContent=accepted?
      accepted+'곡을 이 브라우저에서 미리 듣도록 추가했어요. 다른 사람에게 게시된 것은 아니에요. 관리자 게시 버튼을 이용해 주세요.':
      '100MB 이하의 MP3·M4A·WAV·OGG 파일만 선택해 주세요.';
    event.target.value='';
  }

  const approvedReviews=[];
  async function loadReviews(){
    try{
      const r=await fetch('reviews/reviews.json',{cache:'no-store'});
      if(r.ok){
        const manifest=await r.json();
        if(Array.isArray(manifest.reviews)){
          for(const v of manifest.reviews){
            if(typeof v.file==='string'&&videoRe.test(v.file))
              approvedReviews.push({title:String(v.title||displayName(v.file)),file:v.file,consentConfirmed:v.consentConfirmed===true});
          }
        }
      }
    }catch(_){}
    // On a public repo, newly posted videos with consent can be listed automatically.
    try{
      const r=await fetch('https://api.github.com/repos/tlco1003/Song/contents/docs/reviews',{cache:'no-store'});
      if(r.ok){
        const files=await r.json();
        if(Array.isArray(files)){
          for(const f of files.filter(f=>f.type==='file'&&videoRe.test(f.name))){
            if(!approvedReviews.some(v=>v.file===f.name))
              approvedReviews.push({title:displayName(f.name),file:f.name,consentConfirmed:true});
          }
        }
      }
    }catch(_){}
    renderReviews();
  }
  function renderReviews(){
    const gallery=$('withu-review-gallery');gallery.textContent='';
    if(!approvedReviews.length){
      const empty=document.createElement('div');empty.className='withu-review-empty';
      empty.innerHTML='<span aria-hidden="true">▷</span><strong>실제 영상 후기를 준비하고 있어요</strong><p>공개에 동의한 사용자 후기 영상이 등록되면 이곳에서 직접 볼 수 있어요. 현재는 실제 영상이 없어 임의로 만들거나 게시하지 않았습니다.</p>';
      gallery.appendChild(empty);
      return;
    }
    for(const rev of approvedReviews){
      const card=document.createElement('article');card.className='withu-review-card';
      const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';
      video.src='reviews/'+encodeURIComponent(rev.file);
      const h=document.createElement('h3');h.textContent=rev.title;
      const p=document.createElement('p');p.textContent='WITHU에 게시된 실제 후기 영상';
      card.append(video,h,p);gallery.appendChild(card);
    }
  }
  function previewReview(event){
    const file=event.target.files?.[0];
    if(!file)return;
    if(!videoRe.test(file.name)||file.size>300*1024*1024){
      $('withu-review-note').textContent='300MB 이하 MP4 또는 WebM 영상만 선택할 수 있어요.';
      return;
    }
    const url=URL.createObjectURL(file);
    state.videoUrls.push(url);
    const gallery=$('withu-review-gallery');
    const card=document.createElement('article');card.className='withu-review-card local-preview';
    const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=url;
    const h=document.createElement('h3');h.textContent=displayName(file.name)+' · 내 기기 미리보기';
    const p=document.createElement('p');p.textContent='이 영상은 웹사이트에 게시되지 않았어요. 관리자만 공개 파일로 등록할 수 있습니다.';
    card.append(video,h,p);gallery.prepend(card);
    $('withu-review-note').textContent='영상 미리보기를 열었어요. 다른 사람에게 공개되지 않았습니다.';
    event.target.value='';
  }
  $('withu-prev').addEventListener('click',()=>selectTrack(state.current-1));
  $('withu-next').addEventListener('click',()=>selectTrack(state.current+1));
  audio.addEventListener('ended',()=>selectTrack(state.current+1,true));
  $('withu-upload-music').addEventListener('change',onLocalSongUpload);
  $('withu-upload-review').addEventListener('change',previewReview);
  $('withu-refresh-media').addEventListener('click',async()=>{
    $('withu-refresh-media').disabled=true;
    status('게시된 파일을 다시 확인하고 있어요…');
    try{
      state.tracks=state.tracks.filter(t=>t.local);
      state.tracks=[];
      await loadTracks();
      await loadReviews();
    }finally{$('withu-refresh-media').disabled=false;}
  });
  // URL whitelist protects these admin links from accidentally accepting arbitrary locations.
  for(const id of ['withu-publish-music','withu-publish-review']){
    const a=$(id);if(!canUseGithub(a.href))a.hidden=true;
  }
  window.addEventListener('pagehide',()=>{
    for(const u of [...state.localUrls,...state.videoUrls])URL.revokeObjectURL(u);
  });
  void loadTracks();
  void loadReviews();
})();