/* WITHU browser-only media previews. Nothing is uploaded or retained.
 * No actual face swap, payment, order, or song generation occurs here. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const audio = $('audio-preview-element');
  const LIMIT = 30;
  const state = {audioUrl:null,photoUrl:null,videoUrl:null,stream:null,recorder:null,
    recordTimer:null,recordStart:0,audioTimer:null,recordChunks:[]};

  const format = seconds => {
    const whole = Math.max(0,Math.min(LIMIT,Math.floor(Number(seconds)||0)));
    return String(Math.floor(whole/60)).padStart(2,'0')+':'+String(whole%60).padStart(2,'0');
  };
  const audioNotice = message => { $('audio-preview-message').textContent=message; };
  const cameraNotice = message => { $('camera-feedback').textContent=message; };
  const selectedProduct = () => document.querySelector('input[name="product"]:checked')?.value;
  function requireConsent() {
    if($('media-consent').checked)return true;
    cameraNotice('사진과 영상에 등장하는 인물의 사용 동의를 먼저 확인해 주세요.');
    $('media-consent').focus();return false;
  }
  function revoke(name) {
    if(state[name])URL.revokeObjectURL(state[name]);
    state[name]=null;
  }
  function refreshAudioClock() {
    const elapsed=Math.min(LIMIT,Number(audio.currentTime)||0);
    $('audio-preview-time').textContent=format(elapsed)+' / 00:30';
    $('audio-preview-fill').style.width=(elapsed/LIMIT*100).toFixed(2)+'%';
    if(elapsed>=LIMIT-0.07){
      audio.pause();
      $('audio-preview-play').textContent='▶ 30초 다시 듣기';
      audioNotice('30초 미리 듣기가 끝났어요. 처음부터 다시 들을 수 있어요.');
    }
  }
  function pauseAudio() {
    audio.pause();
    $('audio-preview-play').textContent='▶ 30초 듣기';
  }
  function setAudio(url) {
    pauseAudio();audio.removeAttribute('src');audio.load();
    if(url){audio.src=url;audio.load();}
    $('audio-preview-time').textContent='00:00 / 00:30';
    $('audio-preview-fill').style.width='0%';
  }
  async function loadExamples() {
    const select=$('audio-example');
    select.replaceChildren();
    try {
      const result=await fetch('media/tracks.json',{cache:'no-store'});
      if(!result.ok)throw Error('missing tracks');
      const data=await result.json();
      const tracks=(Array.isArray(data.tracks)?data.tracks:[])
        .filter(t=>typeof t.title==='string'&&/^[a-zA-Z0-9가-힣_.-]+\.mp3$/i.test(t.file));
      if(!tracks.length)throw Error('no samples');
      for(const track of tracks){
        const option=document.createElement('option');
        option.value=track.file;option.textContent=track.title;
        select.append(option);
      }
      select.selectedIndex=0;
      setAudio('media/'+encodeURIComponent(select.value));
      audioNotice('기존에 공개된 예시곡을 선택했어요. 재생을 누르면 30초만 들려줍니다.');
    }catch(_){
      const option=document.createElement('option');
      option.value='';option.textContent='지금은 예시곡 목록을 불러올 수 없어요';
      select.append(option);
      audioNotice('예시곡을 불러오지 못했어요. 직접 음악 파일을 선택하면 30초 미리 듣기가 가능해요.');
    }
  }
  $('audio-example').addEventListener('change',()=>{
    revoke('audioUrl');
    const file=$('audio-example').value;
    if(file)setAudio('media/'+encodeURIComponent(file));
    else setAudio('');
    audioNotice('예시곡을 변경했어요. 재생 버튼을 눌러보세요.');
  });
  $('audio-file-choice').addEventListener('change',event=>{
    const file=event.target.files?.[0];
    if(!file)return;
    if(file.size>100*1024*1024||!/\.(mp3|m4a|wav|ogg)$/i.test(file.name)){
      audioNotice('100MB 이하 MP3·M4A·WAV·OGG 파일만 선택할 수 있어요.');return;
    }
    revoke('audioUrl');
    state.audioUrl=URL.createObjectURL(file);
    setAudio(state.audioUrl);
    audioNotice('선택한 내 음악을 이 브라우저에서 30초만 미리 들어요. 업로드되지 않습니다.');
    event.target.value='';
  });
  $('audio-preview-play').addEventListener('click',async()=>{
    if(!audio.src){audioNotice('예시곡이나 내 음악 파일을 먼저 선택해 주세요.');return;}
    if(!audio.paused){pauseAudio();return;}
    if(Number(audio.currentTime)>=LIMIT-0.07){
      try{audio.currentTime=0;}catch(_){}
    }
    try{
      await audio.play();
      $('audio-preview-play').textContent='Ⅱ 일시정지';
      audioNotice('30초 미리 듣는 중이에요.');
    }catch(_){
      audioNotice('음악을 재생할 수 없어요. 파일 형식이나 Safari의 소리 설정을 확인해 주세요.');
    }
  });
  $('audio-preview-reset').addEventListener('click',()=>{
    pauseAudio();try{audio.currentTime=0;}catch(_){}
    refreshAudioClock();audioNotice('처음으로 돌아왔어요.');
  });
  audio.addEventListener('timeupdate',refreshAudioClock);
  audio.addEventListener('seeking',()=>{
    if(audio.currentTime>LIMIT){try{audio.currentTime=LIMIT;}catch(_){}}
  });
  audio.addEventListener('ended',()=>{pauseAudio();audioNotice('미리 듣기가 끝났어요.');});
  audio.addEventListener('error',()=>{pauseAudio();audioNotice('이 예시곡을 불러오지 못했어요. 다른 곡이나 로컬 파일을 선택해 주세요.');});
  // timeupdate can be throttled when a device sleeps; use a second guard.
  state.audioTimer=setInterval(()=>{
    if(!audio.paused&&audio.currentTime>=LIMIT){
      audio.pause();refreshAudioClock();
    }
  },200);

  function showPhoto(file) {
    if(!requireConsent())return;
    if(!file||file.size>15*1024*1024||!(/image\//.test(file.type)||/\.(jpg|jpeg|png|webp|heic)$/i.test(file.name))){
      $('photo-feedback').textContent='15MB 이하 이미지 파일을 선택해 주세요.';return;
    }
    revoke('photoUrl');state.photoUrl=URL.createObjectURL(file);
    const img=$('photo-preview'),stage=$('stage-portrait-image');
    for(const item of [img,stage]){item.src=state.photoUrl;item.hidden=false;}
    $('photo-empty').hidden=true;$('stage-placeholder').hidden=true;
    $('photo-feedback').textContent='선택한 사진을 이 기기에서 미리 보고 있어요.';
  }
  function showVideoBlob(file) {
    if(!requireConsent())return;
    if(!file||file.size>200*1024*1024||!/^(video\/|application\/octet-stream)/.test(file.type||'video/')&&!/\.(mp4|mov|webm)$/i.test(file.name||'')){
      $('video-feedback').textContent='200MB 이하 MP4·MOV·WebM 영상을 선택해 주세요.';return;
    }
    revoke('videoUrl');state.videoUrl=URL.createObjectURL(file);
    const video=$('video-preview');
    video.pause();video.src=state.videoUrl;video.hidden=false;video.load();
    $('video-empty').hidden=true;
    $('video-feedback').textContent='영상 미리보기입니다. 아직 서버에 업로드되거나 얼굴 교체가 적용되지 않았어요.';
  }
  $('face-photo').addEventListener('change',e=>{
    if(e.target.files?.[0])showPhoto(e.target.files[0]);
    e.target.value='';
  });
  for(const id of ['face-video','native-camera-capture']){
    $(id).addEventListener('change',e=>{
      if(e.target.files?.[0])showVideoBlob(e.target.files[0]);
      e.target.value='';
    });
  }
  $('photo-preview').addEventListener('error',()=>{
    $('photo-feedback').textContent='이 기기에서 사진을 표시하지 못했어요. JPG 또는 PNG를 선택해 주세요.';
  });
  $('video-preview').addEventListener('error',()=>{
    $('video-feedback').textContent='이 영상은 브라우저에서 재생되지 않아요. MP4(H.264) 영상을 사용해 주세요.';
  });
  function setRecordingUI(recording) {
    $('start-camera-record').disabled=recording||!state.stream;
    $('stop-camera-record').disabled=!recording;
    $('open-camera').disabled=recording||!!state.stream;
    $('close-camera').disabled=recording||!state.stream;
  }
  function closeCamera(discardRecording=false) {
    // Clearing media must not asynchronously re-add a recording on MediaRecorder.onstop.
    if(discardRecording&&state.recorder)state.recorder.onstop=null;
    if(state.recorder?.state==='recording')state.recorder.stop();
    if(state.recordTimer)clearInterval(state.recordTimer);
    state.recordTimer=null;
    for(const track of state.stream?.getTracks()||[])track.stop();
    state.stream=null;
    $('camera-live').srcObject=null;$('camera-live').hidden=true;
    $('camera-empty').hidden=false;setRecordingUI(false);
    $('record-timer').textContent='촬영 최대 00:30';
  }
  $('open-camera').addEventListener('click',async()=>{
    if(!requireConsent())return;
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){
      cameraNotice('이 브라우저에서 카메라를 열 수 없어요. HTTPS Safari에서 열거나 기본 카메라 촬영을 사용해 주세요.');return;
    }
    try{
      try{
        state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720}},audio:true});
      }catch(err){
        // If microphone access is blocked, a silent face video is still useful.
        state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:720}},audio:false});
      }
      const live=$('camera-live');live.srcObject=state.stream;live.hidden=false;
      $('camera-empty').hidden=true;
      await live.play().catch(()=>{});
      setRecordingUI(false);
      cameraNotice('전면 카메라가 켜졌어요. 준비되면 녹화 시작을 눌러주세요.');
    }catch(error){
      closeCamera();
      cameraNotice('카메라 접근이 허용되지 않았거나 사용할 수 없어요. iPhone 설정을 확인하거나 기본 카메라 촬영 버튼을 사용해 주세요.');
    }
  });
  const mimeType=()=>{
    if(typeof window.MediaRecorder==='undefined')return null;
    const variants=['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4',
      'video/webm;codecs=vp8,opus','video/webm'];
    return variants.find(x=>MediaRecorder.isTypeSupported?.(x))||'';
  };
  $('start-camera-record').addEventListener('click',()=>{
    if(!state.stream||!requireConsent())return;
    const mime=mimeType();
    if(mime===null){
      cameraNotice('이 브라우저는 웹 녹화를 지원하지 않아요. 휴대폰 기본 카메라로 촬영해 주세요.');return;
    }
    try{
      state.recordChunks=[];
      state.recorder=new MediaRecorder(state.stream,mime?{mimeType:mime}:undefined);
      const recorder=state.recorder;
      recorder.ondataavailable=event=>{if(event.data?.size)state.recordChunks.push(event.data)};
      recorder.onstop=()=>{
        if(state.recordTimer)clearInterval(state.recordTimer);
        state.recordTimer=null;
        const result=new Blob(state.recordChunks,{type:recorder.mimeType||'video/mp4'});
        if(result.size){
          const ext=result.type.includes('webm')?'webm':'mp4';
          showVideoBlob(new File([result],'withu-selfie-30s.'+ext,{type:result.type}));
          cameraNotice('녹화를 종료했어요. 오른쪽 영상 미리보기에서 확인할 수 있어요. 서버에는 전송하지 않았습니다.');
        }else cameraNotice('녹화 파일이 비어 있어요. 다시 촬영하거나 기본 카메라를 사용해 주세요.');
        setRecordingUI(false);
      };
      recorder.onerror=()=>{cameraNotice('녹화 중 오류가 발생했어요. 기본 카메라 촬영으로 시도해 주세요.');};
      recorder.start(500);
      state.recordStart=Date.now();
      setRecordingUI(true);
      $('record-timer').textContent='녹화 중 00:00 / 00:30';
      cameraNotice('녹화 중이에요. 최대 30초 후 자동 종료됩니다.');
      state.recordTimer=setInterval(()=>{
        const seconds=Math.min(LIMIT,(Date.now()-state.recordStart)/1000);
        $('record-timer').textContent='녹화 중 '+format(seconds)+' / 00:30';
        if(seconds>=LIMIT&&recorder.state==='recording')recorder.stop();
      },200);
    }catch(_){
      setRecordingUI(false);
      cameraNotice('녹화를 시작할 수 없어요. 휴대폰 기본 카메라 촬영을 사용해 주세요.');
    }
  });
  $('stop-camera-record').addEventListener('click',()=>{
    if(state.recorder?.state==='recording')state.recorder.stop();
  });
  $('close-camera').addEventListener('click',()=>{closeCamera();cameraNotice('카메라를 껐어요.');});
  function clearMedia(){
    closeCamera(true);
    $('face-photo').value='';$('face-video').value='';$('native-camera-capture').value='';
    const v=$('video-preview');v.pause();v.removeAttribute('src');v.load();v.hidden=true;
    const photo=$('photo-preview'),stage=$('stage-portrait-image');
    for(const node of [photo,stage]){node.removeAttribute('src');node.hidden=true;}
    $('photo-empty').hidden=false;$('video-empty').hidden=false;$('stage-placeholder').hidden=false;
    $('photo-feedback').textContent='사진을 선택하면 여기에서 확인할 수 있어요.';
    $('video-feedback').textContent='영상을 선택하거나 촬영하면 여기에서 재생할 수 있어요.';
    revoke('photoUrl');revoke('videoUrl');
  }
  $('clear-media-preview').addEventListener('click',clearMedia);
  function switchProduct(){
    const show=selectedProduct()==='audio_video';
    $('video-media-section').hidden=!show;
    if(!show&&state.stream)closeCamera(true);
  }
  for(const radio of document.querySelectorAll('input[name="product"]')){
    radio.addEventListener('change',switchProduct);
  }
  $('media-consent').addEventListener('change',()=>{
    if(!$('media-consent').checked&&state.stream)closeCamera(true);
  });
  window.addEventListener('pagehide',()=>{
    closeCamera(true);audio.pause();
    clearInterval(state.audioTimer);
    for(const name of ['audioUrl','photoUrl','videoUrl'])revoke(name);
  });
  // Test links can open the matching product without any customer data in the URL.
  const requestedProduct=new URLSearchParams(window.location.search).get('product');
  if(requestedProduct==='audio_video'||requestedProduct==='audio_duo'){
    const radio=document.querySelector('input[name="product"][value="'+requestedProduct+'"]');
    if(radio){radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  switchProduct();
  void loadExamples();
})();