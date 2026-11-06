/* WITHU optional photo/video consent and device-only previews.
 * There is NO pre-purchase audio listening or payment execution in this file.
 * The customer's selected media are never uploaded by this script. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const LIMIT=30;
 const state={photoUrl:null,videoUrl:null,stream:null,recorder:null,
  recordTimer:null,recordStart:0,recordChunks:[]};
 const format=seconds=>{
  const whole=Math.max(0,Math.min(LIMIT,Math.floor(Number(seconds)||0)));
  return String(Math.floor(whole/60)).padStart(2,'0')+':'+String(whole%60).padStart(2,'0');
 };
 const cameraNotice=message=>{$('camera-feedback').textContent=message;};
 const selectedProduct=()=>document.querySelector('input[name="product"]:checked')?.value;
 function requireConsent(){
  if($('media-consent').checked)return true;
  cameraNotice('사진과 영상에 등장하는 인물의 사용 동의를 먼저 확인해 주세요.');
  $('media-consent').focus();return false;
 }
 function revoke(name){
  if(state[name])URL.revokeObjectURL(state[name]);
  state[name]=null;
 }
  function showPhoto(file) {
    if(!file||file.size>15*1024*1024||!(/image\//.test(file.type)||/\.(jpg|jpeg|png|webp|heic)$/i.test(file.name))){
      $('photo-feedback').textContent='15MB 이하 이미지 파일을 선택해 주세요.';return;
    }
    revoke('photoUrl');state.photoUrl=URL.createObjectURL(file);
    const img=$('photo-preview'),stage=$('stage-portrait-image');
    for(const item of [img,stage]){item.src=state.photoUrl;item.hidden=false;}
    $('photo-empty').hidden=true;$('stage-placeholder').hidden=true;
    $('photo-filename').textContent='선택한 사진: '+file.name.slice(0,120);
    $('photo-filename').hidden=false;
    $('clear-face-photo').hidden=false;
    $('photo-feedback').textContent='사진 선택 완료 · 이 기기에서 바로 확인할 수 있어요. 서버에는 전송하지 않았어요.';
  }
  function showVideoBlob(file) {
    if(!file||file.size>200*1024*1024||
      !(/^(?:video\/|application\/octet-stream)/.test(file.type||'')||/\.(mp4|mov|webm)$/i.test(file.name||''))){
      $('video-feedback').textContent='200MB 이하 MP4·MOV·WebM 영상을 선택해 주세요.';return;
    }
    revoke('videoUrl');state.videoUrl=URL.createObjectURL(file);
    const video=$('video-preview');
    video.pause();video.src=state.videoUrl;video.hidden=false;video.load();
    $('video-empty').hidden=true;
    $('video-filename').textContent='선택한 영상: '+file.name.slice(0,120);
    $('video-filename').hidden=false;
    $('clear-face-video').hidden=false;
    $('video-feedback').textContent='영상 선택 완료 · 위 미리보기의 ▶ 버튼을 눌러 확인할 수 있어요. 서버에는 전송하지 않았어요.';
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
  function clearPhoto(){
    $('face-photo').value='';
    const photo=$('photo-preview'),stage=$('stage-portrait-image');
    for(const node of [photo,stage]){node.removeAttribute('src');node.hidden=true;}
    $('photo-empty').hidden=false;$('stage-placeholder').hidden=false;
    $('photo-filename').textContent='';$('photo-filename').hidden=true;
    $('clear-face-photo').hidden=true;
    $('photo-feedback').textContent='사진을 선택하면 바로 아래에서 확인할 수 있어요.';
    revoke('photoUrl');
  }
  function clearVideo(){
    $('face-video').value='';$('native-camera-capture').value='';
    const v=$('video-preview');v.pause();v.removeAttribute('src');v.load();v.hidden=true;
    $('video-empty').hidden=false;
    $('video-filename').textContent='';$('video-filename').hidden=true;
    $('clear-face-video').hidden=true;
    $('video-feedback').textContent='영상을 선택하면 바로 아래에서 재생할 수 있어요.';
    revoke('videoUrl');
  }
  function clearMedia(){
    closeCamera(true);
    clearPhoto();
    clearVideo();
  }
  $('clear-face-photo').addEventListener('click',clearPhoto);
  $('clear-face-video').addEventListener('click',clearVideo);
  $('clear-media-preview').addEventListener('click',clearMedia);
  function switchProduct(){
    const show=selectedProduct()==='audio_video';
    $('video-media-section').hidden=!show;
    if(!show)clearMedia();
  }
  for(const radio of document.querySelectorAll('input[name="product"]')){
    radio.addEventListener('change',switchProduct);
  }
  $('media-consent').addEventListener('change',()=>{
    if(!$('media-consent').checked&&state.stream)closeCamera(true);
  });
  window.addEventListener('pagehide',()=>{
    closeCamera(true);
    for(const name of ['photoUrl','videoUrl'])revoke(name);
  });
  // Test links can open the matching product without any customer data in the URL.
  const requestedProduct=new URLSearchParams(window.location.search).get('product');
  if(requestedProduct==='audio_video'||requestedProduct==='audio_duo'){
    const radio=document.querySelector('input[name="product"][value="'+requestedProduct+'"]');
    if(radio){radio.checked=true;radio.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  switchProduct();
  window.addEventListener('withu:checkout-stage',event=>{
    if(event.detail?.stage!=='product'&&state.stream)closeCamera(true);
  });
})();