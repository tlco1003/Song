/**
 * Final delivery transition: after all purchased tracks are operator-reviewed
 * and commercially verified, send the private song link automatically.
 * Never start on a browser payment claim or an unreviewed AI candidate.
 *
 * This function is pure so worker/idempotency tests can exercise the safety
 * boundary without a live Firebase or email provider.
 */
export function reviewedPaidOrderReadyForAutoDelivery(before,after){
 if(!after||after.paymentStatus!=='paid'||after.state==='refunded'
  ||typeof after.paymentKey!=='string'||after.paymentKey.length<6
  ||!Number.isSafeInteger(after.paymentVerifiedAt)||after.paymentVerifiedAt<=0
  ||after.delivery?.status!=='not_sent')return false;
 const count=after.productId==='audio_duo'?2:
  after.productId==='audio'?1:null;
 if(!count||!Array.isArray(after.tracks)||after.tracks.length!==count)return false;
 const ready=o=>Array.isArray(o?.tracks)&&o.tracks.length===count
  &&o.tracks.every((t,i)=>t?.index===i+1
   &&t.reviewed===true&&t.rightsVerified===true
   &&typeof t.storagePath==='string'
   &&t.storagePath.startsWith('orders/'+o.id+'/tracks/')
   &&typeof t.title==='string'&&t.title.trim().length>=2
   &&typeof t.lyrics==='string'&&t.lyrics.trim().length>=12);
 if(!ready(after))return false;
 // Only one trigger for the transition to fully approved. A delivery failure
 // is retained for manual retry, preventing unbounded email redispatch.
 if(ready(before))return false;
 return true;
}
