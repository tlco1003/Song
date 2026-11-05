/**
 * PUBLIC, NON-SECRET deployment settings.
 * In Firebase console -> Project Settings -> Your apps -> Web app.
 * Never put TOSS_SECRET_KEY or Firebase Admin service account JSON here.
 *
 * Set enabled:true only after Firebase production validation and code review.
 * Browser keys/project IDs are identifiers, not payment authorization.
 */
export const WITHU_PAYMENT_PUBLIC_CONFIG=Object.freeze({
  enabled:false,
  firebase:Object.freeze({
    apiKey:'',
    authDomain:'',
    projectId:'',
    appId:''
  }),
  appCheckEnterpriseSiteKey:''
});
