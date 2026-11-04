// WITHU (repository: Song): GPT lyric authoring + official Suno MCP music creation.
const $=id=>document.getElementById(id);
const state={apiToken:'',busy:false,sunoReady:false};
function answers(){
  return {
    recipient:$('recipient').value.trim(),
    memory:$('memory').value.trim(),
    message:$('message').value.trim(),
    gratitudeApology:$('gratitudeApology').value.trim(),
    occasion:$('occasion').value,
    recipientAgeGroup:$('recipientAgeGroup').value,
    relativePosition:$('relativePosition').value,
    speechStyle:$('speechStyle').value,
    genre:$('genre').value,mood:$('mood').value,lyricLength:$('lyricLength').value
  };
}
function validateAnswers(){
  const a=answers();
  if(!a.recipient){alert('상대방을 어떻게 부르는지 입력해 주세요.');$('recipient').focus();return false;}
  if((a.memory+a.message+a.gratitudeApology).length<10){
    alert('추억·전할 말·고마움 중 10자 이상 입력해 주세요.');$('message').focus();return false;
  }
  return true;
}
async function request(route,options={}){
  const headers={
    ...(options.body?{'Content-Type':'application/json'}:{}),
    ...(state.apiToken?{'x-app-token':state.apiToken}:{})
  };
  let response=await fetch(route,{...options,headers:{...headers,...options.headers}});
  if(response.status===401&&!state.apiToken){
    const token=prompt('이 서비스의 관리자 접근 코드를 입력하세요.');
    if(token){state.apiToken=token;response=await fetch(route,{...options,headers:{...headers,'x-app-token':token}});}
  }
  let json;
  try{json=await response.json();}catch(_){json={error:'서버 응답을 읽지 못했습니다.'};}
  if(!response.ok)throw Error(json.error||'요청 실패: HTTP '+response.status);
  return json;
}
function invalidate(){
  $('sunoPreview').classList.add('hidden');
  $('nav1').classList.add('current');$('nav2').classList.remove('current');
  $('stageLabel').textContent='STEP 01 · THE STORY';
  $('sunoMcpResult').textContent='';$('sunoMcpStatus').textContent='';
  $('mcpConsent').checked=false;
}
async function config(){
  try{
    const v=await request('/api/config');
    state.sunoReady=v.sunoAutomatedGenerationReady===true;
    $('setupState').textContent=state.sunoReady?'● 음악 제작 준비됨':'○ 음악 제작 준비 중';
    $('setupState').title='가사 제작: '+(v.lyricsReady?'준비됨':'설정 중')+
      ' / 음악: '+(state.sunoReady?'준비됨':'연결 준비 중');
    $('sunoMcpStatus').textContent=state.sunoReady?
      '음악 제작 준비가 완료됐습니다. 동의 후 진행할 수 있습니다.':
      '음악 제작 서비스를 연결하고 있습니다.';
  }catch(e){$('setupState').textContent='서버 접근 확인 필요';}
}
async function generateLyrics(){
  if(!validateAnswers())return;
  if($('draftLyrics').value.trim()&&!confirm('현재 가사 초안을 새로 생성한 내용으로 교체할까요?'))return;
  const btn=$('generateLyrics');btn.disabled=true;
  $('lyricsNotice').textContent='당신의 이야기를 노랫말로 옮기고 있어요…';
  try{
    const result=await request('/api/lyrics',{method:'POST',body:JSON.stringify(answers())});
    $('draftLyrics').value=result.lyrics;
    invalidate();
    $('lyricsNotice').textContent='첫 번째 가사를 완성했어요. 마음에 들 때까지 직접 고쳐보세요.';
  }catch(e){$('lyricsNotice').textContent='가사 작성에 실패했어요: '+e.message;}
  finally{btn.disabled=false;}
}
async function prepare(){
  if(!validateAnswers())return;
  const lyrics=$('draftLyrics').value.trim();
  if(lyrics.length<12){$('lyricsNotice').textContent='먼저 가사를 생성하거나 12자 이상 직접 작성해 주세요.';return;}
  const btn=$('toVoice');btn.disabled=true;
  try{
    const pack=await request('/api/suno-package',{method:'POST',body:JSON.stringify({...answers(),lyrics})});
    $('sunoLyrics').value=pack.lyrics;
    $('sunoStyle').value=pack.stylePrompt;
    $('openSuno').href=pack.sunoUrl;
    $('sunoStatus').textContent='가사와 음악 분위기가 준비됐어요. 내용을 확인해 주세요.';
    $('sunoPreview').classList.remove('hidden');
    $('nav1').classList.remove('current');$('nav2').classList.add('current');
    $('stageLabel').textContent='STEP 02 · YOUR MUSIC';
    $('sunoPreview').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){$('lyricsNotice').textContent='준비 실패: '+e.message;}
  finally{btn.disabled=false;}
}
async function copyText(id,label){
  const el=$(id);el.focus();el.select();
  try{
    if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
    await navigator.clipboard.writeText(el.value);
    $('sunoStatus').textContent=label+를 복사했어요.';
  }catch(_){$('sunoStatus').textContent='복사가 제한됐어요. 선택된 텍스트를 수동으로 복사하세요.';}
}
async function createWithMcp(){
  if($('sunoPreview').classList.contains('hidden')){alert('가사와 스타일을 다시 준비해 주세요.');return;}
  if(!$('mcpConsent').checked){alert('음악 제작 시 자료 전송과 사용량 차감에 동의해 주세요.');return;}
  if(!confirm('음악 제작 과정에서 사용량이 차감될 수 있습니다. 진행할까요?'))return;
  const button=$('generateSunoMcp');button.disabled=true;
  $('sunoMcpStatus').textContent='노래를 만들고 있어요…';
  $('sunoMcpResult').textContent='';
  try{
    const result=await request('/api/suno-mcp/create',{
      method:'POST',
      body:JSON.stringify({...answers(),lyrics:$('sunoLyrics').value,
        confirmedCreditSpend:true,consentMcpDataTransfer:true})
    });
    $('sunoMcpStatus').textContent=result.note||'노래 제작 요청이 완료됐어요.';
    $('sunoMcpResult').textContent=[result.response,...(result.toolResults||[]).map(x=>x.output)].filter(Boolean).join('\n\n').slice(0,18000);
  }catch(e){$('sunoMcpStatus').textContent='노래 제작에 실패했어요: '+e.message;}
  finally{button.disabled=false;}
}
function example(){
  $('recipient').value='엄마';
  $('memory').value='늘 열심히 일하고 사람을 배려하는 모습, 나를 안아 주던 순간, 사랑이 담긴 눈빛';
  $('message').value='내 마음속엔 언제나 엄마가 최고야. 엄마 딸이라서 참 다행이야.';
  $('gratitudeApology').value='늘 내 생각을 먼저 해 주고 사랑으로 안아 줘서 고마워.';
  $('occasion').value='감사';
  $('relativePosition').value='older';$('speechStyle').value='casual';$('recipientAgeGroup').value='unknown';
  invalidate();
}
for(const id of ['recipient','memory','message','gratitudeApology','occasion','recipientAgeGroup',
  'relativePosition','speechStyle','genre','mood','lyricLength','draftLyrics']){
  $(id).addEventListener('input',invalidate);
}
$('generateLyrics').addEventListener('click',generateLyrics);
$('toVoice').addEventListener('click',prepare);
$('copySunoLyrics').addEventListener('click',()=>copyText('sunoLyrics','가사'));
$('copySunoStyle').addEventListener('click',()=>copyText('sunoStyle','음악 스타일'));
$('generateSunoMcp').addEventListener('click',createWithMcp);
$('fillExample').addEventListener('click',example);
$('openInfo').addEventListener('click',()=>$('infoDialog').showModal());
$('closeInfo').addEventListener('click',()=>$('infoDialog').close());
$('understood').addEventListener('click',()=>$('infoDialog').close());
void config();
