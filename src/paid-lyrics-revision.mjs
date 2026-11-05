/**
 * WITHU post-payment lyric revision authorization contract.
 *
 * The public song-creation form has no edit or copy controls. Only an order
 * owner's verified authenticated session may view or submit lyric revisions.
 * This module does not create an HTTP route or bypass a missing paid-order DB.
 */
import {ORDER_STATES} from './commerce.mjs';

const ALLOWED_STATES=new Set([
 ORDER_STATES.PAID,ORDER_STATES.GENERATING_MUSIC,
 ORDER_STATES.MUSIC_READY,ORDER_STATES.READY_TO_DELIVER,
 ORDER_STATES.DELIVERED
]);
function assertPaidCustomer(session,order){
 if(!session||session.authenticated!==true||session.emailVerified!==true
   ||typeof session.userId!=='string'||!session.userId
   ||typeof order?.customerId!=='string'||order.customerId!==session.userId
   ||!order.paymentVerifiedAt||!order.paymentKey||!ALLOWED_STATES.has(order.state)
   ||order.revisionAllowed!==true)
   throw new Error('Authenticated paid customer and authorized revision window required');
}
function checkLyrics(lyrics){
 if(typeof lyrics!=='string')throw new TypeError('Lyrics must be text');
 const normalized=lyrics.trim();
 if(normalized.length<12||normalized.length>5500)
  throw new Error('Lyrics must be between 12 and 5500 characters');
 return normalized;
}
/**
 * A trusted backend must verify the customer session and order ownership from
 * its database BEFORE invoking this function. Do not accept a client order
 * object or payment claims as proof.
 */
export function viewPaidLyrics({session,order}){
 assertPaidCustomer(session,order);
 return Object.freeze({
  orderId:order.id,
  title:order.songTitle,
  lyrics:order.confirmedLyrics,
  revisionVersion:order.revisionVersion||0,
  editingAllowed:true
 });
}
export async function requestPaidLyricsRevision({
 session,order,lyrics,expectedVersion,store
}){
 assertPaidCustomer(session,order);
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0
   ||expectedVersion!==(order.revisionVersion||0))
   throw new Error('Lyrics revision version has changed; reload the order');
 const edited=checkLyrics(lyrics);
 if(edited===order.confirmedLyrics.trim())
   throw new Error('There is no change to submit');
 if(typeof store?.createRevisionRequestAtomic!=='function')
   throw new Error('Durable revision storage adapter missing');
 // The store MUST transactionally check owner, PAID, immutable original,
 // revision cap, service policy and optimistic revision version. This does NOT
 // regenerate music or charge money. Human review/revision policy applies.
 return store.createRevisionRequestAtomic({
  orderId:order.id,customerId:session.userId,
  expectedVersion,newLyrics:edited,
  requestKey:'revision:'+order.id+':'+(expectedVersion+1),
  nextStatus:'revision_requested'
 });
}
