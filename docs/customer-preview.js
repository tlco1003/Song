(()=>{
'use strict';
const button=document.getElementById('commercial-upgrade-buy');
const status=document.getElementById('commercial-upgrade-status');
const file=document.getElementById('preview-file-button');
const banner=document.querySelector('.preview-notice');
if(!button||!status||!file)return;
let paidScreen=false;
button.disabled=false;
button.addEventListener('click',()=>{
 paidScreen=!paidScreen;
 if(paidScreen){
  status.textContent='[시연] 10,000원 추가 결제가 실제 확인되면 다운로드 버튼이 이 위치에 나타납니다. 이 화면에서는 결제·상업적 이용권·파일 제공이 발생하지 않아요.';
  button.textContent='추가 결제 전 화면으로 돌아가기';
  file.hidden=false;file.disabled=true;
  banner?.setAttribute('data-preview-upgrade','shown');
 }else{
  status.textContent='기본 감상권 상태예요. 상업적 이용 허락과 원본 파일은 별도 10,000원 실제 결제 및 권리 확인 후 제공됩니다.';
  button.textContent='10,000원 결제 후 화면 미리보기 · 무료 시연';
  file.hidden=true;banner?.removeAttribute('data-preview-upgrade');
 }
});
})();