/**
 * Operator fulfillment entry point.
 *
 * A trusted worker passes an actual paid/verified/finalized order and its
 * operator-approved song list, plus a durable private order store.
 * Do not use this entry point from public checkout requests.
 *
 * All external keys are read from protected server environment variables.
 * This function alone does not make a public checkout payable.
 */
import {issuePrivateDeliveryInvitation,dispatchPrivateListeningNotification}
 from './private-delivery-invitation.mjs';
import {createBizgoMobileNotifier,createResendTransactionalMailer}
 from './withu-notification-providers.mjs';

export async function dispatchCompletedMusicToCustomer({
 order,selectedSongs,orders,config=process.env,fetcher=globalThis.fetch
}={}){
 // Order validation and recipient authentication live in invitation issuer;
 // channel-specific server adapters are created only for that channel.
 const invitation=issuePrivateDeliveryInvitation({
  order,selectedSongs,origin:config.WITHU_PUBLIC_BASE_URL
 });
 const channel=invitation.deliveryChannel;
 const provider=channel==='email'?
  {mailer:createResendTransactionalMailer({config,fetcher})}:
  {mobileNotifier:createBizgoMobileNotifier({config,fetcher})};
 const result=await dispatchPrivateListeningNotification({
  invitation,orders,...provider
 });
 // Only provider acceptance is reported; delivery-read confirmation requires
 // official provider delivery reports and a durable sent/outbox audit table.
 return Object.freeze({
  orderId:result.orderId,channel,
  acceptedForDelivery:Boolean(result.messageId),
  gatewayMessageId:result.messageId
 });
}
