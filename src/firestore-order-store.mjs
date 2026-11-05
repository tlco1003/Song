/**
 * Firestore store port for src/paid-order-pipeline.mjs.
 * Firestore Admin SDK only: NEVER import into browser code.
 *
 * Collections: withuOrders, withuCheckoutRequests, withuCheckoutLimits,
 * withuFulfillmentOutbox. Client SDK access is denied by firestore.rules.
 */
import {ORDER_STATES} from './commerce.mjs';

const LOCK_MS=90_000;
const WINDOW_MS=10*60_000;
const MAX_NEW_ORDERS_PER_WINDOW=5;

export function makeFirestoreOrderStore({db,FieldValue,now=()=>Date.now()}){
  if(typeof db?.runTransaction!=='function'||!FieldValue?.serverTimestamp)
    throw new Error('Firestore Admin SDK is required');
  const orderRef=id=>db.collection('withuOrders').doc(id);
  const requestRef=(uid,id)=>db.collection('withuCheckoutRequests').doc(uid+'_'+id);
  const limitRef=uid=>db.collection('withuCheckoutLimits').doc(uid);
  const jobRef=id=>db.collection('withuFulfillmentOutbox').doc('fulfill_'+id);
  return Object.freeze({
    async createOnce({order,requestId}){
      if(!order?.ownerUid||!order.id||!requestId)throw new Error('Invalid order');
      return db.runTransaction(async tx=>{
        const reqRef=requestRef(order.ownerUid,requestId);
        const userRef=limitRef(order.ownerUid);
        const [previous,limit]=await Promise.all([tx.get(reqRef),tx.get(userRef)]);
        if(previous.exists){
          const known=await tx.get(orderRef(previous.data().orderId));
          if(!known.exists||known.data().ownerUid!==order.ownerUid)
            throw new Error('Checkout request conflict');
          return {order:known.data(),duplicate:true};
        }
        const current=now();
        const old=limit.exists?limit.data():{};
        const windowStart=Number.isSafeInteger(old.windowStart)&&current-old.windowStart<WINDOW_MS
          ?old.windowStart:current;
        const count=windowStart===old.windowStart?(old.count||0):0;
        if(count>=MAX_NEW_ORDERS_PER_WINDOW)throw new Error('CHECKOUT_RATE_LIMITED');
        tx.create(orderRef(order.id),{
          ...order,createdAt:FieldValue.serverTimestamp(),
          paymentConfirmation:null,paymentVerifiedAt:null
        });
        tx.create(reqRef,{orderId:order.id,ownerUid:order.ownerUid,createdAt:FieldValue.serverTimestamp()});
        tx.set(userRef,{windowStart,count:count+1},{merge:true});
        return {order,duplicate:false};
      });
    },
    async getById(id){
      const snap=await orderRef(id).get();
      return snap.exists?snap.data():null;
    },
    async reserveConfirmationAtomic({orderId,paymentKey}){
      return db.runTransaction(async tx=>{
        const ref=orderRef(orderId),snap=await tx.get(ref);
        if(!snap.exists)throw new Error('Unknown order');
        const row=snap.data();
        if(row.state===ORDER_STATES.PAID){
          if(row.paymentKey!==paymentKey)throw new Error('DIFFERENT_PAYMENT_KEY');
          return 'already_paid';
        }
        if(row.state!==ORDER_STATES.PAYMENT_PENDING)throw new Error('ORDER_NOT_PENDING');
        const prior=row.paymentConfirmation;
        if(prior?.paymentKey&&prior.paymentKey!==paymentKey)
          throw new Error('ORDER_ALREADY_BOUND_TO_ANOTHER_PAYMENT');
        if(prior?.leaseUntil>now())return 'busy';
        tx.update(ref,{paymentConfirmation:{
          paymentKey,leaseUntil:now()+LOCK_MS,status:'confirming',
          lastAttemptAt:FieldValue.serverTimestamp()
        }});
        return 'reserved';
      });
    },
    async recordPendingDepositAtomic({orderId,paymentKey,providerSecret}){
      return db.runTransaction(async tx=>{
        const ref=orderRef(orderId),snap=await tx.get(ref);
        if(!snap.exists||snap.data().state!==ORDER_STATES.PAYMENT_PENDING)
          throw new Error('Deposit order not pending');
        const row=snap.data();
        if(row.paymentConfirmation?.paymentKey!==paymentKey
          ||(row.issuedPaymentKey&&row.issuedPaymentKey!==paymentKey))
          throw new Error('Deposit payment key mismatch');
        // Secret is server-only for future authenticated deposit callbacks.
        tx.update(ref,{issuedPaymentKey:paymentKey,
          issuedDepositSecret:providerSecret||row.issuedDepositSecret||null,
          paymentConfirmation:{paymentKey,status:'awaiting_deposit',leaseUntil:0}
        });
        return {status:'waiting_for_deposit'};
      });
    },
    async confirmPaidAndEnqueueAtomic({orderId,paymentKey,amountKrw,expectedState,nextState,route,jobKey,songPlan,providerMethod}){
      if(expectedState!==ORDER_STATES.PAYMENT_PENDING||nextState!==ORDER_STATES.PAID
        ||jobKey!=='fulfill:'+orderId||!songPlan?.songs?.length)
        throw new Error('Invalid payment transaction');
      return db.runTransaction(async tx=>{
        const ref=orderRef(orderId),outbox=jobRef(orderId);
        const [snap,job]=await Promise.all([tx.get(ref),tx.get(outbox)]);
        if(!snap.exists)throw new Error('Unknown order');
        const row=snap.data();
        if(row.state===ORDER_STATES.PAID){
          if(row.paymentKey!==paymentKey||!job.exists)
            throw new Error('Paid order inconsistency');
          return {outcome:'duplicate',route:row.fulfillmentRoute};
        }
        if(row.state!==expectedState||row.amountKrw!==amountKrw
          ||row.paymentConfirmation?.paymentKey!==paymentKey||job.exists)
          throw new Error('Concurrent or mismatched payment transaction');
        tx.update(ref,{
          state:ORDER_STATES.PAID,paymentKey,paymentVerifiedAt:FieldValue.serverTimestamp(),
          fulfillmentRoute:route,paidSongPlan:JSON.parse(JSON.stringify(songPlan)),
          providerMethod:providerMethod||null,
          paymentConfirmation:{paymentKey,status:'verified',leaseUntil:0}
        });
        tx.create(outbox,{
          key:jobKey,orderId,route,status:'queued',attempts:0,
          createdAt:FieldValue.serverTimestamp()
        });
        return {outcome:'created',route};
      });
    }
  });
}
