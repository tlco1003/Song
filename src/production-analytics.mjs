/** Privacy-minimized, aggregate funnel metrics. No customer text or email stored. */
// Firebase is installed in the deployed Functions package, not root test package.
// Import it lazily only when an actual Firestore event is recorded.
import {now,json,stop,checkOrigin,respond} from './production-runtime.mjs';
export const PUBLIC_EVENTS=Object.freeze([
 'home_view','story_started','story_submitted','packages_view',
 'package_selected','checkout_opened','payment_attempted'
]);
const perInstance=new Map();
export function safeFunnelEvent(input){
 if(!input||typeof input!=='object'||Array.isArray(input)
  ||!PUBLIC_EVENTS.includes(input.event)||Object.keys(input).some(k=>k!=='event'))
  throw Error('Unrecognized anonymous funnel event');
 return input.event;
}
function dayKey(ms){return new Date(ms).toISOString().slice(0,10);}
function limit(req){
 const key=String(req.ip||req.socket?.remoteAddress||'anonymous');
 const minute=Math.floor(now()/60000),slot=perInstance.get(key);
 if(!slot||slot.minute!==minute){perInstance.set(key,{minute,count:1});}
 else if(slot.count>=25)stop(429,'분석 이벤트 요청이 너무 많습니다.');
 else slot.count++;
 if(perInstance.size>2000)perInstance.clear();
}
export async function handleFunnelEvent(req,res,{db,env}){
 const path=new URL(req.originalUrl||req.url,'https://placeholder.invalid').pathname;
 if(path!=='/api/analytics/event')return false;
 if(req.method!=='POST')stop(405,'POST만 허용합니다.');
 checkOrigin(req,env);limit(req);
 let event;
 try{event=safeFunnelEvent(json(req,500));}
 catch(_){stop(400,'이벤트 형식이 올바르지 않습니다.');}
 const {FieldValue}=await import('firebase-admin/firestore');
 await db.collection('withuAnalyticsDaily').doc(dayKey(now())).set({
  day:dayKey(now()),events:{[event]:FieldValue.increment(1)},
  updatedAt:now()
 },{merge:true});
 respond(res,202,{status:'accepted'});return true;
}
export async function recordVerifiedPurchase(db,orderId,{upgrade=false}={}){
 const {FieldValue}=await import('firebase-admin/firestore');
 const marker=db.collection('withuAnalyticsConversions').doc(
  (upgrade?'upgrade_':'order_')+orderId);
 const day=dayKey(now()),daily=db.collection('withuAnalyticsDaily').doc(day);
 await db.runTransaction(async tx=>{
  const existing=await tx.get(marker);
  if(existing.exists)return;
  tx.create(marker,{kind:upgrade?'upgrade':'paid_order',createdAt:now()});
  tx.set(daily,{day,events:{[upgrade?'upgrade_verified':'purchase_verified']:FieldValue.increment(1)},
   updatedAt:now()},{merge:true});
 });
}
export async function readFunnelSummary(db,days=7){
 const count=Math.max(1,Math.min(30,Number(days)||7)),today=now(),rows=[];
 for(let offset=0;offset<count;offset++){
  const date=dayKey(today-offset*86400000);
  rows.push({date,ref:db.collection('withuAnalyticsDaily').doc(date)});
 }
 const snaps=await Promise.all(rows.map(row=>row.ref.get()));
 return rows.map((row,i)=>({date:row.date,events:
  Object.fromEntries([...PUBLIC_EVENTS,'purchase_verified','upgrade_verified'].map(key=>[
   key,Math.max(0,Number(snaps[i].data()?.events?.[key])||0)
  ]))}));
}
