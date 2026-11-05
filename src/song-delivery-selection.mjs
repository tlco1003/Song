/**
 * WITHU deliverable selection gate.
 *
 * A provider (including Suno after B2B approval) may return two candidates
 * from one generation request. That NEVER changes the number purchased.
 * A trusted operator/quality checker must select exactly ONE approved,
 * stored asset for EACH paid song slot before the delivery worker can run.
 *
 * No public HTTP route, email attachment or automatic candidate selection
 * is created by this module.
 */
import {ORDER_STATES} from './commerce.mjs';
import {verifyPaidSongPlan} from './song-production-plan.mjs';

function safeId(value){
 return typeof value==='string'&&/^[A-Za-z0-9_-]{4,128}$/.test(value);
}
function readyAsset(value){
 return typeof value==='string'
  &&value.length<=400
  &&/^private\/[A-Za-z0-9_/.-]+\.(mp3|m4a|wav)$/.test(value)
  &&!value.includes('..')&&!value.includes('//');
}
export function prepareCustomerDeliverables({order,candidateBatches,selections}){
 if(order?.state!==ORDER_STATES.READY_TO_DELIVER||!order.paymentVerifiedAt
   ||typeof order.paymentKey!=='string'||!order.paymentKey)
   throw new Error('Only verified-paid, approved deliverables may be selected');
 const plan=verifyPaidSongPlan(order);
 if(!Array.isArray(candidateBatches)||candidateBatches.length!==plan.songs.length
   ||!Array.isArray(selections)||selections.length!==plan.songs.length)
   throw new Error('Exactly one selection per purchased song required');
 const chosenAssetIds=new Set();
 const output=plan.songs.map(song=>{
  const batch=candidateBatches.find(b=>b?.index===song.index);
  if(!batch||candidateBatches.filter(b=>b?.index===song.index).length!==1
    ||!Array.isArray(batch.candidates)||batch.candidates.length===0)
    throw new Error('Missing unique production candidate batch');
  const selection=selections.find(x=>x?.index===song.index);
  if(!selection||selections.filter(x=>x?.index===song.index).length!==1
    ||!safeId(selection.candidateId))
    throw new Error('Exactly one chosen candidate per song required');
  const matches=batch.candidates.filter(c=>c?.id===selection.candidateId);
  if(matches.length!==1||matches[0].status!=='READY'||!readyAsset(matches[0].privateAssetKey))
    throw new Error('Selected song candidate is not verified and ready');
  if(chosenAssetIds.has(matches[0].privateAssetKey))
    throw new Error('Two purchased slots cannot deliver the same music file');
  chosenAssetIds.add(matches[0].privateAssetKey);
  return Object.freeze({
   index:song.index,title:song.title,genre:song.genre,
   candidateId:selection.candidateId,
   privateAssetKey:matches[0].privateAssetKey
  });
 });
 return Object.freeze({
  orderId:order.id,deliveryCount:output.length,
  songs:Object.freeze(output)
 });
}
