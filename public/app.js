const $ = id => document.getElementById(id);
const state={step:1,recorder:null,stream:null,chunks:[],started:0,recording:null,recordingMime:'',timer:null,voiceId:sessionStorage.getItem('song_voice_id')||'',voiceVerified:sessionStorage.getItem('song_voice_verified')==='true',jobId:sessionStorage.getItem('song_job_id')||'',busy:false,apiToken:''};
const stageLabels=['STEP 01 · THE STORY','STEP 02 · YOUR VOICE','STEP 03 · YOUR SONG'];
const stages=['작곡·가창 생성 중','리드 보컬과 반주 분리 중','내 목소리로 변환 중','반주와 보컬 믹싱 중'];
const fileTypes=['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/ogg'];

function setNotice(message,kind='info',target='voiceNotice') {const el=$(target);el.textContent=message;el.classList.remove('hidden','error','success');if(kind!=='info')el.classList.add(kind);}
function toggleBusy(busy) {state.busy=busy;for(const id of ['toVoice','registerVoice','startJob','deleteVoice','deleteJob'])$(id).disabled=busy;}
function go(step) {state.step=step;for(let i=1;i<=3;i++) {$( `stage${i}`).classList.toggle('hidden',i!==step);$( `nav${i}`).classList.toggle('current',i===step);} $('stageLabel').textContent=stageLabels[step-1];window.scrollTo({top:Math.min(window.scrollY,370),behavior:'smooth'});}
function songBrief(){return {recipient:$('recipient').value.trim(),memory:$('memory').value.trim(),message:$('message').value.trim(),gratitudeApology:$('gratitudeApology').value.trim(),occasion:$('occasion').value,genre:$('genre').value,mood:$('mood').value,lyricLength:$('lyricLength').value};}
function validateStory(){const b=songBrief();if(!b.recipient){alert('상대방을 어떻게 부르는지 적어 주세요.');$('recipient').focus();return false;}if((b.memory+b.message+b.gratitudeApology).length<10){alert('추억, 전할 말, 감사·미안함 중 10자 이상 적어 주세요.');$('message').focus();return false;}return true;}
async function request(route, options={}) {
  const headers={...(options.body && typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...(state.apiToken?{'x-app-token':state.apiToken}:{})};
  let res=await fetch(route,{...options,headers:{...headers,...options.headers}});
  if(res.status===401&&!state.apiToken){const token=prompt('서버 접근 토큰을 입력하세요. 개인 서버의 APP_ACCESS_TOKEN 값입니다.');if(token){state.apiToken=token;res=await fetch(route,{...options,headers:{...headers,'x-app-token':token,...options.headers}});}}
  const data=await res.json().catch(()=>({error:`응답을 해석할 수 없습니다 (HTTP ${res.status})`}));
  if(!res.ok)throw new Error(data.error||`서버 오류 HTTP ${res.status}`);
  return data;
}
async function refreshSetup(){try {const config=await request('/api/config');$('setupState').textContent=(config.musicReady&&config.voiceReady)?'● API 준비됨':'○ API 키 설정 필요';$('setupState').title='음악: '+(config.musicReady?'연결 준비':'키 없음')+' / 음성: '+(config.voiceReady?'연결 준비':'키 없음');}catch(e){$('setupState').textContent='서버 연결 확인 필요';}}

function stopTimer(){clearInterval(state.timer);state.timer=null;}
function stopTracks(){for(const t of state.stream?.getTracks()||[])t.stop();state.stream=null;}
function recordingMime(){const types=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'];return types.find(t=>MediaRecorder.isTypeSupported(t))||'';}
function micHelp(error) {
  if (!window.isSecureContext) return '현재 주소가 보안 연결(HTTPS 또는 localhost)이 아니어서 마이크를 사용할 수 없습니다. HTTPS 웹사이트에서 열거나 음성 파일을 업로드하세요.';
  if (error?.name==='NotAllowedError' || error?.name==='SecurityError') return '마이크 권한이 거부되었거나 삽입 화면에서 차단됐습니다. Safari에서 실제 HTTPS 웹앱 주소를 직접 열고 마이크를 허용하거나 파일을 업로드하세요.';
  if (error?.name==='NotFoundError') return '기기에서 사용할 수 있는 마이크를 찾을 수 없습니다.';
  if (error?.name==='NotReadableError') return '다른 앱이 마이크를 사용 중이거나 기기에서 마이크를 시작하지 못했습니다.';
  return error?.message || '마이크 사용에 실패했습니다. 음성 파일 업로드를 이용해 주세요.';
}
function updateMicDiagnostic(){
  const allowed=!!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder && window.isSecureContext;
  const embedded=window.self!==window.top;
  $('micDiagnostic').textContent=(!allowed ? '마이크 사용 불가: HTTPS 및 브라우저 녹음 지원을 확인해 주세요.' : embedded ? '삽입된 화면에서는 마이크 권한이 제한될 수 있습니다. 웹앱을 새 탭에서 직접 열어주세요.' : '마이크 녹음이 가능한 환경입니다. 브라우저 권한 허용은 별도로 필요합니다.');
}
function formatTime(sec){return `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;}
function setRecording(blob, mime){state.recording=blob;state.recordingMime=mime.split(';')[0];if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=URL.createObjectURL(blob);$('voicePreview').src=state.previewUrl;$('voicePreview').classList.remove('hidden');$('recordHelp').textContent=`녹음 완료 · ${(blob.size/1024/1024).toFixed(2)}MB · 미리 들어볼 수 있어요.`;}
async function startRecording(){try {if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('이 브라우저에서 마이크 녹음을 지원하지 않습니다. 파일 업로드를 이용해 주세요.');state.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});const mime=recordingMime();state.recorder=new MediaRecorder(state.stream,mime?{mimeType:mime}:undefined);state.chunks=[];state.recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data)};state.recorder.onstop=()=>{stopTimer();stopTracks();const type=(state.recorder.mimeType||mime||'audio/webm').split(';')[0];setRecording(new Blob(state.chunks,{type}),type);$('recordBtn').classList.remove('hidden');$('stopBtn').classList.add('hidden');$('recordTime').textContent=formatTime(Math.floor((Date.now()-state.started)/1000));document.body.classList.remove('is-recording')};state.recorder.start(1000);state.started=Date.now();$('recordBtn').classList.add('hidden');$('stopBtn').classList.remove('hidden');document.body.classList.add('is-recording');$('recordHelp').textContent='당신의 추억을 소리 내어 자연스럽게 이야기해 보세요.';state.timer=setInterval(()=>{const seconds=Math.floor((Date.now()-state.started)/1000);$('recordTime').textContent=formatTime(seconds);if(seconds>=60)stopRecording();},500);}catch(e){stopTracks();setNotice(micHelp(e),'error');}}
function stopRecording(){if(state.recorder?.state==='recording')state.recorder.stop();}
function readBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=()=>reject(new Error('녹음 파일 읽기에 실패했습니다.'));r.onload=()=>resolve(String(r.result).split(',')[1]);r.readAsDataURL(blob);});}
async function registerVoice(){try{if(!state.recording)throw new Error('먼저 목소리를 녹음하거나 파일을 선택해 주세요.');if(!$('consent').checked)throw new Error('본인 목소리 이용 및 외부 API 전송 동의를 확인해 주세요.');if(!fileTypes.includes(state.recordingMime))throw new Error('지원되는 오디오 파일을 선택해 주세요.');if(state.recording.size>10_000_000)throw new Error('음성 파일은 10MB 이내여야 합니다.');if(state.voiceId){if(state.voiceVerified){updateSummary();go(3);return;}throw new Error('음성 프로필 본인 확인이 필요합니다. 등록된 공급업체 계정에서 확인하세요.');}toggleBusy(true);setNotice('목소리를 외부 AI에 등록 중입니다. 실제 API 요청이 발생합니다.');const audioBase64=await readBase64(state.recording);const result=await request('/api/voices',{method:'POST',body:JSON.stringify({name:'My SONG voice',mimeType:state.recordingMime,audioBase64,consent:true})});state.voiceId=result.voiceId;state.voiceVerified=!result.requiresVerification;sessionStorage.setItem('song_voice_id',state.voiceId);sessionStorage.setItem('song_voice_verified',String(state.voiceVerified));if(!state.voiceVerified)throw new Error('공급업체에서 추가 본인 확인을 요구합니다. ElevenLabs 계정에서 검증 후 이용하세요.');setNotice('목소리가 등록됐습니다. 노래 만들기로 이동합니다.','success');updateSummary();go(3);}catch(e){setNotice(e.message,'error');}finally{toggleBusy(false);}}
function updateSummary(){if(state.voiceId&&state.voiceVerified){$('registerVoice').textContent='등록된 목소리로 계속하기 →';}else{$('registerVoice').textContent='내 목소리 등록하기 →';}$('summaryGenre').textContent=`${$('genre').value} · ${$('mood').value}`;$('summaryStory').textContent=$('recipient').value.trim()+'에게 · '+$('occasion').value;$('voiceTag').textContent=state.voiceId?'음색 프로필 등록됨':'음성 없음';}
function drawJob(job){const index=stages.indexOf(job.stage);document.querySelectorAll('.progress-item').forEach((el,i)=>{el.classList.toggle('active',job.status==='running'&&index===i);el.classList.toggle('done',job.status==='completed'||(index>=0&&i<index));});if(job.status==='completed'){setNotice('오디오 생성이 완료됐습니다. 음악 품질·목소리 유사도는 직접 들어 확인해 주세요.','success','jobMessage');$('startJob').disabled=false;}else if(job.status==='failed'){setNotice(job.error||'처리 실패','error','jobMessage');$('startJob').disabled=false;}else{setNotice(job.stage,'info','jobMessage');$('startJob').disabled=true;}const labels={original:'AI 원본 가창',vocals:'분리된 원본 보컬',instrumental:'반주',converted:'내 음색으로 변환한 보컬',final:'최종 믹싱 음원'};const grid=$('audioGrid');grid.replaceChildren();for(const [key,url] of Object.entries(job.assets||{})){const row=document.createElement('div');row.className='audio-row';const header=document.createElement('header');const title=document.createElement('span');title.textContent=labels[key]||key;const download=document.createElement('a');download.textContent='다운로드 ↗';download.href=url;download.download=`song-${key}.mp3`;const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=url;header.append(title,download);row.append(header,audio);grid.appendChild(row);} $('results').classList.toggle('hidden',!Object.keys(job.assets||{}).length);$('requestedLyricsOutput').textContent=job.requestedLyrics||'(사연으로 자동 작사 요청됨)';$('lyricsOutput').textContent=job.lyrics||'(모델이 가사 텍스트를 반환하지 않았습니다. 오디오로 확인하세요.)';}
let poller;
async function followJob(id){clearInterval(poller);state.jobId=id;sessionStorage.setItem('song_job_id',id);async function update(){try{const j=await request(`/api/jobs/${id}`);drawJob(j);if(j.status==='failed'||j.status==='completed'){clearInterval(poller);poller=null;}}catch(e){clearInterval(poller);poller=null;setNotice(e.message,'error','jobMessage');$('startJob').disabled=false;}}await update();if(poller===undefined||poller===null){ /* update may have completed */ }if($('startJob').disabled)poller=setInterval(update,2000);}
async function startJob(){if(!validateStory())return;if($('lyricLength').value==='full'){setNotice('전체 가사는 현재 작사·수정까지만 지원합니다. 음악 생성은 30초 분량을 선택해 주세요.','error','jobMessage');return;}if(!state.voiceId||!state.voiceVerified){setNotice('본인 목소리 프로필 등록과 검증이 필요합니다.','error','jobMessage');return;}if(!confirm('실제 Gemini/ElevenLabs 유료 API를 호출합니다. 30초 시험곡 제작을 시작할까요?'))return;try{toggleBusy(true);setNotice('작업 시작을 요청 중입니다.','info','jobMessage');const job=await request('/api/jobs',{method:'POST',body:JSON.stringify({...songBrief(),voiceId:state.voiceId,lyrics:$('draftLyrics').value.trim()})});await followJob(job.id);}catch(e){setNotice(e.message,'error','jobMessage');}finally{toggleBusy(false);$('startJob').disabled=Boolean(poller);}}
async function deleteVoice(){if(!state.voiceId)return alert('등록된 음성 프로필이 없습니다.');if(!confirm('ElevenLabs에 저장된 이 음성 프로필을 삭제할까요? 생성된 노래 파일은 별도로 삭제해야 합니다.'))return;try{toggleBusy(true);await request(`/api/voices/${encodeURIComponent(state.voiceId)}`,{method:'DELETE'});state.voiceId='';state.voiceVerified=false;sessionStorage.removeItem('song_voice_id');sessionStorage.removeItem('song_voice_verified');updateSummary();setNotice('외부 AI 음성 프로필 삭제 요청이 완료됐습니다.','success','jobMessage');}catch(e){setNotice(e.message,'error','jobMessage')}finally{toggleBusy(false);}}
async function deleteJob(){if(!state.jobId)return;if(!confirm('이 작업의 서버 내 음원을 모두 삭제할까요?'))return;try{await request(`/api/jobs/${state.jobId}`,{method:'DELETE'});clearInterval(poller);poller=null;state.jobId='';sessionStorage.removeItem('song_job_id');$('results').classList.add('hidden');setNotice('로컬 서버의 생성 파일을 삭제했습니다. 공급업체의 데이터 보관은 별도 정책에 따릅니다.','success','jobMessage')}catch(e){setNotice(e.message,'error','jobMessage');}}

$('generateLyrics').addEventListener('click',async()=>{
  if(!validateStory())return;
  const btn=$('generateLyrics');btn.disabled=true;
  $('lyricsNotice').textContent='실제 Gemini API에서 가사 초안을 생성 중입니다…';
  try{
    if($('draftLyrics').value.trim() && !confirm('현재 작성한 가사를 새 AI 초안으로 바꾸시겠어요?'))return;
    const result=await request('/api/lyrics',{method:'POST',body:JSON.stringify(songBrief())});
    $('draftLyrics').value=result.lyrics;
    $('lyricsNotice').textContent=$('lyricLength').value==='full'?'전체 가사 초안입니다. 원하는 표현을 수정해 보세요. 현재 작곡은 30초 시험곡만 지원해요.':'30초용 가사 초안입니다. 직접 수정해 작곡에 보낼 수 있지만 실제 발음 일치는 보장되지 않아요.';
  }catch(e){$('lyricsNotice').textContent='가사 생성 실패: '+e.message+' 직접 입력해도 됩니다.';}
  finally{btn.disabled=false;}
});

$('fillExample').addEventListener('click',()=>{$('recipient').value='엄마';$('memory').value='항상 열심히 일하고 사람들을 배려하는 모습, 사랑으로 안아주는 모습, 나를 사랑해 주는 눈빛';$('message').value='내 마음속엔 언제나 엄마가 최고야. 엄마 딸이라서 다행이야.';$('gratitudeApology').value='나만 생각해 주는 한없는 사랑에 감사해. 위대하고 숭고한 사랑이라는 건 엄마를 두고 하는 말이야.';$('occasion').value='감사';});
$('toVoice').addEventListener('click',()=>{if(!validateStory())return;if($('lyricLength').value==='full'){alert('3~4분 전체 가사 작성과 수정은 가능하지만 현재 음악 생성은 30초 시험곡만 지원합니다. 30초 가사로 바꾼 다음 녹음 단계로 이동해 주세요.');return;}go(2)});
$('backToStory').addEventListener('click',()=>go(1));
$('backToVoice').addEventListener('click',()=>go(2));
$('recordBtn').addEventListener('click',startRecording);
$('stopBtn').addEventListener('click',stopRecording);
$('voiceFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(!f)return;if(!fileTypes.includes(f.type)||f.size>10_000_000)return setNotice('지원되지 않는 파일 형식이거나 10MB를 초과합니다.','error');setRecording(f,f.type);});
$('registerVoice').addEventListener('click',registerVoice);
$('startJob').addEventListener('click',startJob);
$('deleteVoice').addEventListener('click',deleteVoice);
$('deleteJob').addEventListener('click',deleteJob);
$('openInfo').addEventListener('click',()=>$('infoDialog').showModal());
$('closeInfo').addEventListener('click',()=>$('infoDialog').close());
$('understood').addEventListener('click',()=>$('infoDialog').close());
updateMicDiagnostic();refreshSetup();updateSummary();
if(state.jobId){updateSummary();go(3);void followJob(state.jobId);}
