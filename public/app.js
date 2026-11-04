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
    const token=prompt('이 WITHU 개발 서버의 APP_ACCESS_TOKEN을 입력하세요. Suno 계정 OAuth 토큰이 아닙니다.');
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
    $('setupState').textContent=state.sunoReady?'● Suno MCP 연결 준비됨':'○ Suno OAuth 연결 필요';
    $('setupState').title='작사: '+(v.lyricsReady?'OpenAI API 키 준비됨':'OPENAI_API_KEY 필요')+
      ' / 음악: '+(state.sunoReady?'공식 Suno MCP 연결 가능':'계정 OAuth 또는 서버 인증 필요');
    $('sunoMcpStatus').textContent=state.sunoReady?
      '정식 Suno MCP 연결 준비됨. 동의 후 노래를 요청할 수 있습니다.':
      '서버에 인증된 Suno OAuth 토큰과 OpenAI API 키가 필요합니다. 직접 Suno Custom 모드 이용도 가능합니다.';
  }catch(e){$('setupState').textContent='서버 접근 확인 필요';}
}
async function generateLyrics(){
  if(!validateAnswers())return;
  if($('draftLyrics').value.trim()&&!confirm('현재 가사 초안을 새로 생성한 내용으로 교체할까요?'))return;
  const btn=$('generateLyrics');btn.disabled=true;
  $('lyricsNotice').textContent='OpenAI GPT가 편지형 가사를 작성하고 있어요…';
  try{
    const result=await request('/api/lyrics',{method:'POST',body:JSON.stringify(answers())});
    $('draftLyrics').value=result.lyrics;
    invalidate();
    $('lyricsNotice').textContent='GPT 가사 초안입니다. 실제 본인의 말처럼 수정한 다음 Suno로 전달하세요.';
  }catch(e){$('lyricsNotice').textContent='GPT 작사 실패: '+e.message;}
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
    $('sunoStatus').textContent='선택한 가사와 편곡 방향을 준비했어요. 복사하거나 공식 Suno MCP 생성을 요청하세요.';
    $('sunoPreview').classList.remove('hidden');
    $('nav1').classList.remove('current');$('nav2').classList.add('current');
    $('stageLabel').textContent='STEP 02 · SUNO MCP';
    $('sunoPreview').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){$('lyricsNotice').textContent='준비 실패: '+e.message;}
  finally{btn.disabled=false;}
}
async function copyText(id,label){
  const el=$(id);el.focus();el.select();
  try{
    if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');
    await navigator.clipboard.writeText(el.value);
    $('sunoStatus').textContent=label+'를 복사했습니다. Suno Custom 모드에 붙여넣으세요.';
  }catch(_){$('sunoStatus').textContent='복사가 제한됐어요. 선택된 텍스트를 수동으로 복사하세요.';}
}
async function createWithMcp(){
  if($('sunoPreview').classList.contains('hidden')){alert('가사와 스타일을 다시 준비해 주세요.');return;}
  if(!$('mcpConsent').checked){alert('Suno에 내용 전송 및 크레딧 사용에 동의해 주세요.');return;}
  if(!confirm('Suno 계정의 크레딧이 소모될 수 있습니다. 공식 Suno MCP로 노래 생성을 요청할까요?'))return;
  const button=$('generateSunoMcp');button.disabled=true;
  $('sunoMcpStatus').textContent='Suno MCP 음악 생성 요청 중…';
  $('sunoMcpResult').textContent='';
  try{
    const result=await request('/api/suno-mcp/create',{
      method:'POST',
      body:JSON.stringify({...answers(),lyrics:$('sunoLyrics').value,
        confirmedCreditSpend:true,consentMcpDataTransfer:true})
    });
    $('sunoMcpStatus').textContent=result.note||'공식 Suno MCP 호출을 확인했어요.';
    $('sunoMcpResult').textContent=[result.response,...(result.toolResults||[]).map(x=>x.output)].filter(Boolean).join('\n\n').slice(0,18000);
  }catch(e){$('sunoMcpStatus').textContent='Suno MCP 생성 실패: '+e.message;}
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
