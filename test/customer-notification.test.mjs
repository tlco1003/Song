import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORDER_STATES} from '../src/commerce.mjs';
import {normalizeKoreanMobile,normalizeDeliveryChannel,validateCheckoutDeliveryContact}
 from '../src/customer-notification-contact.mjs';
import {issuePrivateDeliveryInvitation,dispatchPrivateListeningNotification}
 from '../src/private-delivery-invitation.mjs';
import {createBizgoMobileNotifier,createResendTransactionalMailer}
 from '../src/withu-notification-providers.mjs';
import {dispatchCompletedMusicToCustomer} from '../src/dispatch-completed-music.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const order={
 id:'ORDER_202611060001',productId:'audio',state:ORDER_STATES.READY_TO_DELIVER,
 paymentVerifiedAt:'2026-11-06T03:00:00Z',paymentKey:'pg-verified-001',
 recipientVerified:true,customerEmail:'buyer@example.test',
 customerPhone:'010-1234-5678',deliveryChannel:'kakao',
 phoneVerified:true,deliveryConsent:true
};
const songs=[{index:1,candidateId:'track_001'}];
const providerConfig={
 WITHU_PUBLIC_BASE_URL:'https://withu.example/',
 WITHU_BIZGO_AUTHORIZATION:'ApiKey signed_unit_test_key',
 WITHU_BIZGO_SMS_SENDER:'0212345678',
 WITHU_BIZGO_KAKAO_SENDER_KEY:'registered_sender_key',
 WITHU_BIZGO_KAKAO_TEMPLATE_CODE:'WITHU_MUSIC_READY_APPROVED',
 WITHU_BIZGO_KAKAO_TEMPLATE_TEXT:'[WITHU] 주문하신 노래가 완성됐어요. 아래 버튼에서 감상하세요.',
 RESEND_API_KEY:'re_unit_test_key_not_real',
 WITHU_FROM_EMAIL:'WITHU <music@withu.example>'
};
const providerSuccess=()=>({
 ok:true,async json(){return {
  common:{authCode:'A000'},data:{code:'A000',data:{destinations:[{
   to:'01012345678',code:'A000',msgKey:'bizgo_mock_message_001'
  }]}}
 };}});
const getInvite=(channel='kakao')=>issuePrivateDeliveryInvitation({
 order:{...order,deliveryChannel:channel},selectedSongs:songs,origin:'https://withu.example/'
});

test('payment replaces duplicate email confirmation with a phone and three opt-in delivery options',()=>{
 const html=read('docs/payment.html'),script=read('docs/payment.js');
 assert.equal((html.match(/id="delivery-email"/g)||[]).length,1);
 assert.ok(!html.includes('id="delivery-email-again"'));
 assert.match(html,/id="delivery-phone"[^>]*type="tel"/);
 for(const [value,label] of [['email','이메일'],['sms','문자 링크'],['kakao','카카오 알림톡']]){
  assert.match(html,new RegExp('name="deliveryChannel" value="'+value+'"'));
  assert.ok(html.includes(label));
 }
 assert.match(html,/동의합니다/);
 assert.match(html,/id="confirm-checkout"[^>]*disabled/);
 assert.match(script,/checkContact/);
 assert.match(script,/customerPhone:phone/);
 assert.ok(!script.includes('delivery-email-again'));
 assert.ok(!script.includes('RESEND_API_KEY'));
 assert.ok(!script.includes('WITHU_BIZGO_AUTHORIZATION'));
});
test('backend validates customer email, domestic phone, channel and contact consent',()=>{
 assert.equal(normalizeKoreanMobile('010-1234-5678'),'01012345678');
 assert.equal(normalizeKoreanMobile('010 1234 5678'),'01012345678');
 assert.equal(normalizeDeliveryChannel('sms'),'sms');
 assert.deepEqual(validateCheckoutDeliveryContact({
  customerEmail:'  Buyer@Example.Test  ',customerPhone:'010-1234-5678',
  deliveryChannel:'kakao',deliveryConsent:true
 }),{
  customerEmail:'buyer@example.test',customerPhone:'01012345678',
  deliveryChannel:'kakao',deliveryConsent:true
 });
 for(const phone of ['011','00000000000','+821012345678','010999','010-ABCD-1234']){
  assert.throws(()=>normalizeKoreanMobile(phone),/Valid Korean mobile/);
 }
 assert.throws(()=>normalizeDeliveryChannel('advertising'),/Unknown/);
 assert.throws(()=>validateCheckoutDeliveryContact({
  customerEmail:order.customerEmail,customerPhone:order.customerPhone,deliveryChannel:'sms',
  deliveryConsent:false
 }),/consent/);
});
test('mobile invitation requires verified paid order and explicitly confirmed phone owner',()=>{
 const invite=getInvite('kakao');
 assert.equal(invite.phone,'01012345678');
 assert.equal(invite.deliveryChannel,'kakao');
 assert.equal(invite.mobileRecipientVerified,true);
 assert.match(invite.deliveryUrl,/^https:\/\/withu\.example\/my-music\.html#delivery=[A-Za-z0-9_-]{43}$/);
 assert.ok(!invite.deliveryUrl.includes(invite.phone));
 for(const patch of [{phoneVerified:false},{deliveryConsent:false},
  {customerPhone:'invalid'},{state:ORDER_STATES.DRAFT}]){
  assert.throws(()=>issuePrivateDeliveryInvitation({
   order:{...order,...patch},selectedSongs:songs,origin:'https://withu.example/'
  }));
 }
});
test('delivery dispatch persists token hash before sending and selects exactly one channel',async()=>{
 const invitation=getInvite('sms'),events=[];
 const result=await dispatchPrivateListeningNotification({
  invitation,
  orders:{async saveDeliveryTokenHashAtomic(item){events.push(['store',item]);}},
  mobileNotifier:{async sendMobileListeningLink(item){
   events.push(['sms',item]);return {accepted:true,messageId:'mock_sms_001'};
  }}
 });
 assert.deepEqual(events.map(x=>x[0]),['store','sms']);
 assert.equal(events[1][1].phone,'01012345678');
 assert.equal(events[1][1].channel,'sms');
 assert.equal(events[1][1].listeningUrl,invitation.deliveryUrl);
 assert.equal(result.status,'accepted_for_delivery');
 assert.equal(result.channel,'sms');
 assert.ok(!JSON.stringify(events[0][1]).includes(invitation.deliveryUrl));
 await assert.rejects(dispatchPrivateListeningNotification({
  invitation,mobileNotifier:{sendMobileListeningLink:async()=>({accepted:true,messageId:'x'})}
 }),/store/);
 const email=getInvite('email');
 assert.equal(email.phone,null);
 const events2=[];
 const sent=await dispatchPrivateListeningNotification({
  invitation:email,
  orders:{saveDeliveryTokenHashAtomic:async()=>events2.push('stored')},
  mailer:{sendPersonalListeningLink:async()=>{events2.push('email');return {messageId:'mock_email_001'};}}
 });
 assert.deepEqual(events2,['stored','email']);
 assert.equal(sent.messageId,'mock_email_001');
});
test('Bizgo LMS request uses registered sender, long link and provider idempotency',async()=>{
 const calls=[];
 const notifier=createBizgoMobileNotifier({
  config:providerConfig,fetcher:async(url,options)=>{
   calls.push({url,options});return providerSuccess();
  }
 });
 const invite=getInvite('sms');
 const sent=await notifier.sendMobileListeningLink({
  channel:'sms',phone:invite.phone,listeningUrl:invite.deliveryUrl,
  orderId:invite.orderId,idempotencyKey:'delivery-sms-'+invite.orderId
 });
 assert.equal(sent.accepted,true);
 assert.equal(sent.channel,'sms');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://mars.ibapi.kr/api/comm/v1/send/omni');
 const body=JSON.parse(calls[0].options.body);
 assert.equal(body.destinations[0].to,'01012345678');
 assert.equal(body.idempotencyTtl,86400);
 assert.equal(body.messageFlow[0].mms.from,providerConfig.WITHU_BIZGO_SMS_SENDER);
 assert.ok(body.messageFlow[0].mms.text.includes(invite.deliveryUrl));
 assert.equal(body.messageFlow[0].sms,undefined);
 assert.equal(calls[0].options.headers.Authorization,providerConfig.WITHU_BIZGO_AUTHORIZATION);
});
test('approved Kakao Alimtalk template has exact operator copy and private My Music URL button',async()=>{
 const req=[];
 const notifier=createBizgoMobileNotifier({
  config:providerConfig,
  fetcher:async(url,options)=>{req.push({url,options});return providerSuccess();}
 });
 const invite=getInvite('kakao');
 const receipt=await notifier.sendMobileListeningLink({
  channel:'kakao',phone:invite.phone,listeningUrl:invite.deliveryUrl,
  orderId:invite.orderId,idempotencyKey:'delivery-kakao-'+invite.orderId
 });
 assert.equal(receipt.accepted,true);
 const body=JSON.parse(req[0].options.body);
 const at=body.messageFlow[0].alimtalk;
 assert.equal(at.msgType,'AT');
 assert.equal(at.senderKey,providerConfig.WITHU_BIZGO_KAKAO_SENDER_KEY);
 assert.equal(at.templateCode,providerConfig.WITHU_BIZGO_KAKAO_TEMPLATE_CODE);
 assert.equal(at.text,providerConfig.WITHU_BIZGO_KAKAO_TEMPLATE_TEXT);
 assert.equal(at.attachment.button[0].type,'WL');
 assert.equal(at.attachment.button[0].urlMobile,invite.deliveryUrl);
 assert.equal(at.attachment.button[0].urlPc,invite.deliveryUrl);
});
test('missing key or invalid provider response cannot report successful SMS/Kakao delivery',async()=>{
 const invite=getInvite();
 let calls=0;
 const fetcher=async()=>{calls++;return providerSuccess();};
 await assert.rejects(createBizgoMobileNotifier({
  config:{...providerConfig,WITHU_BIZGO_AUTHORIZATION:''},fetcher
 }).sendMobileListeningLink({
  channel:'kakao',phone:invite.phone,listeningUrl:invite.deliveryUrl,
  orderId:invite.orderId,idempotencyKey:'send_no_key_001'
 }),/configured/);
 assert.equal(calls,0);
 await assert.rejects(createBizgoMobileNotifier({
  config:providerConfig,fetcher:async()=>({ok:true,json:async()=>({common:{authCode:'E500'}})})
 }).sendMobileListeningLink({
  channel:'kakao',phone:invite.phone,listeningUrl:invite.deliveryUrl,
  orderId:invite.orderId,idempotencyKey:'send_bad_status_001'
 }),/has not accepted/);
 await assert.rejects(createBizgoMobileNotifier({
  config:providerConfig,fetcher
 }).sendMobileListeningLink({
  channel:'kakao',phone:invite.phone,listeningUrl:'http://evil.example/music',
  orderId:invite.orderId,idempotencyKey:'send_bad_url_001'
 }),/Only authorized HTTPS/);
});
test('Resend email adapter uses server key, verified origin and idempotency',async()=>{
 const req=[],invite=getInvite('email');
 const mailer=createResendTransactionalMailer({
  config:providerConfig,
  fetcher:async(url,options)=>{
   req.push({url,options});return {ok:true,async json(){return {id:'resend_mock_email_001'};}};
  }
 });
 const sent=await mailer.sendPersonalListeningLink({
  to:'buyer@example.test',listeningUrl:invite.deliveryUrl,
  subject:'WITHU · 주문하신 노래가 완성됐어요',
  idempotencyKey:'delivery-email-'+invite.orderId
 });
 assert.equal(sent.messageId,'resend_mock_email_001');
 assert.equal(req.length,1);
 assert.equal(req[0].url,'https://api.resend.com/emails');
 assert.equal(req[0].options.headers['Idempotency-Key'],'delivery-email-'+invite.orderId);
 const body=JSON.parse(req[0].options.body);
 assert.deepEqual(body.to,['buyer@example.test']);
 assert.ok(body.text.includes(invite.deliveryUrl));
 assert.ok(body.html.includes(invite.deliveryUrl));
 assert.match(body.html,/받은 음악 선물 열어보기/);
 assert.match(body.html,/원본 음원과 상업적 이용/);
 assert.ok(!body.text.includes('RESEND_API_KEY'));
 assert.ok(!body.html.includes('RESEND_API_KEY'));
});

test('fulfilled production order dispatch chooses SMS gateway only after protected token storage',async()=>{
 const calls=[];
 const result=await dispatchCompletedMusicToCustomer({
  order:{...order,deliveryChannel:'sms'},selectedSongs:songs,
  config:providerConfig,
  orders:{async saveDeliveryTokenHashAtomic(payload){
   calls.push({type:'stored',payload});
  }},
  fetcher:async(_url,opts)=>{
   calls.push({type:'sent',body:JSON.parse(opts.body)});
   return providerSuccess();
  }
 });
 assert.equal(result.channel,'sms');
 assert.equal(result.acceptedForDelivery,true);
 assert.deepEqual(calls.map(x=>x.type),['stored','sent']);
 assert.equal(calls[1].body.destinations[0].to,'01012345678');
 assert.equal(calls[1].body.messageFlow[0].sms,undefined);
 assert.ok(calls[1].body.messageFlow[0].mms);
 assert.ok(!JSON.stringify(calls[0].payload).includes('#delivery='));
 await assert.rejects(dispatchCompletedMusicToCustomer({
  order:{...order,state:ORDER_STATES.DRAFT,deliveryChannel:'sms'},
  selectedSongs:songs,config:providerConfig,
  orders:{saveDeliveryTokenHashAtomic:async()=>{}},
  fetcher:async()=>{throw Error('Must never call gateway');}
 }),/verified paid order/);
});
test('server dispatch refuses unconfigured provider keys even after order authorization',async()=>{
 let attempts=0;
 await assert.rejects(dispatchCompletedMusicToCustomer({
  order:{...order,deliveryChannel:'kakao'},
  selectedSongs:songs,
  config:{...providerConfig,WITHU_BIZGO_AUTHORIZATION:''},
  orders:{saveDeliveryTokenHashAtomic:async()=>{}},
  fetcher:async()=>{attempts++;return providerSuccess();}
 }),/configured/);
 assert.equal(attempts,0);
});
