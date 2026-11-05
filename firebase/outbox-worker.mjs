/**
 * Server-only outbox dispatcher. A client can neither create a PAID order
 * nor trigger email by writing Firestore: firestore.rules deny all writes.
 * Only previously verified PAID orders can reach the operator.
 *
 * At-least-once delivery + Resend Idempotency-Key; manual reconciliation is
 * required for uncertain provider outcomes and after provider retention ends.
 */
import {randomUUID} from 'node:crypto';
import {onDocumentCreated} from 'firebase-functions/v2/firestore';
import {onSchedule} from 'firebase-functions/v2/scheduler';
import {defineSecret,defineString} from 'firebase-functions/params';
import {executePaidJob,FULFILLMENT_ROUTE} from '../src/paid-order-pipeline.mjs';
import {makeResendOperatorEmail} from '../src/operator-notification.mjs';
import {ORDER_STATES} from '../src/commerce.mjs';

export function makeWithuFulfillmentHandlers({db,FieldValue,approved}){
  const resendSecret=defineSecret('RESEND_API_KEY');
  const from=defineString('WITHU_FROM_EMAIL',{default:''});
  const to=defineString('WITHU_OPERATOR_EMAIL',{default:''});
  const activated=defineString('WITHU_OUTBOX_WORKER_VERIFIED',{default:'no'});
  const options={region:'asia-northeast3',secrets:[resendSecret],maxInstances:5};

  async function dispatch(jobId){
    if(!approved()||activated.value()!=='yes')return;
    const jobRef=db.collection('withuFulfillmentOutbox').doc(jobId);
    const claim=await db.runTransaction(async tx=>{
      const jobSnap=await tx.get(jobRef);
      if(!jobSnap.exists)return null;
      const row=jobSnap.data(),current=Date.now();
      if(row.status==='sent'||row.status==='failed')return null;
      if(row.status==='claimed'&&row.leaseUntil>current)return null;
      if(!['queued','claimed'].includes(row.status))return null;
      if((row.attempts||0)>=10){
        tx.update(jobRef,{status:'failed',lastError:'REQUIRES_OPERATOR_REVIEW'});
        return null;
      }
      const orderRef=db.collection('withuOrders').doc(row.orderId);
      const orderSnap=await tx.get(orderRef);
      if(!orderSnap.exists)throw Error('Outbox order missing');
      const order=orderSnap.data();
      if(order.state!==ORDER_STATES.PAID||!order.paymentVerifiedAt||!order.paymentKey
        ||row.route!==FULFILLMENT_ROUTE.HUMAN
        ||row.key!=='fulfill:'+order.id)
        throw Error('Unverified paid fulfillment event');
      const claimToken=randomUUID();
      tx.update(jobRef,{
        status:'claimed',claimToken,leaseUntil:current+3*60_000,
        attempts:(row.attempts||0)+1,lastClaimAt:FieldValue.serverTimestamp()
      });
      return {job:{...row,status:'claimed'},order,claimToken};
    });
    if(!claim)return;
    // Deliberately not inside the Firestore transaction: network effects
    // must use the provider's idempotency key, not transaction retries.
    const operatorEmail=makeResendOperatorEmail({
      apiKey:resendSecret.value(),from:from.value(),to:to.value()
    });
    const result=await executePaidJob({
      job:claim.job,order:claim.order,operatorEmail
    });
    await db.runTransaction(async tx=>{
      const snap=await tx.get(jobRef);
      if(!snap.exists||snap.data().claimToken!==claim.claimToken
        ||snap.data().status!=='claimed')return;
      tx.update(jobRef,{
        status:'sent',leaseUntil:0,
        providerMessageId:result.providerResult.messageId,
        sentAt:FieldValue.serverTimestamp()
      });
    });
  }
  return {
    notifyPaidWithuOrder:onDocumentCreated({
      document:'withuFulfillmentOutbox/{jobId}',...options,retry:true
    },async event=>{
      if(event.params?.jobId)await dispatch(event.params.jobId);
    }),
    retryWithuOutbox:onSchedule({
      schedule:'every 5 minutes',...options,timeZone:'Asia/Seoul'
    },async()=>{
      if(!approved()||activated.value()!=='yes')return;
      const snap=await db.collection('withuFulfillmentOutbox')
        .where('status','in',['queued','claimed']).limit(30).get();
      for(const doc of snap.docs){
        try{await dispatch(doc.id);}
        catch(error){console.error('WITHU_OUTBOX_RETRY_FAILED',doc.id);}
      }
    })
  };
}
