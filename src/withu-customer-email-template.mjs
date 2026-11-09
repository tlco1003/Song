/**
 * Transactional HTML email with one validated, server-minted order-scoped URL.
 * Never insert customer prose, raw filenames or untrusted HTML into this mail.
 */
function escapeHtml(value){
 return String(value).replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 })[ch]);
}
export function composeCompletedMusicEmail({listeningUrl}={}){
 if(typeof listeningUrl!=='string'||!/^https:\/\//.test(listeningUrl))
  throw new Error('Verified HTTPS listening URL required');
 const subject='WITHU · 주문하신 노래가 완성됐어요';
 const text='소중한 이야기가 노래가 되었어요.\n나의 노래함에서 감상하고 가사를 확인하세요.\n'+
  '나의 노래함: '+listeningUrl+
  '\n\n원본 파일과 상업적 이용은 별도 10,000원 결제/권리 확인 후 제공됩니다.'+
  '\n링크를 공유하면 받은 사람도 해당 주문 노래를 감상할 수 있습니다.\n\nWITHU';
 const html="<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"></head><body style=\"background:#f5f0f3;padding:0;margin:0;color:#504252;font-family:Arial,'Malgun Gothic',sans-serif\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"background:#f5f0f3\"><tr><td align=\"center\" style=\"padding:32px 12px\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:570px;background:#fff;border-radius:14px;overflow:hidden\"><tr><td align=\"center\" style=\"background:#2c222e;color:#fff;padding:45px 20px 34px\"><div style=\"font-size:12px;letter-spacing:4px;color:#efcbdd\">WITHU · MUSIC LETTER</div><h1 style=\"font-size:29px;font-weight:normal;line-height:1.45;margin:18px 0 8px\">당신의 이야기가<br>노래가 되었어요.</h1><p style=\"font-size:14px;color:#f0e5ed;margin:0\">완성된 음악 선물을 열어보세요.</p></td></tr><tr><td align=\"center\" style=\"padding:35px 27px 38px\"><p style=\"font-size:14px;line-height:2;color:#605262;margin:0 0 16px\">안녕하세요. WITHU입니다.<br>소중한 마음을 담은 음악이 완성됐습니다.<br>아래 버튼을 누르면 나의 노래함으로 이동해요.</p><table role=\"presentation\" cellspacing=\"0\" cellpadding=\"0\" width=\"100%\" style=\"margin:18px 0 22px;background:#fbf4f8;border-radius:10px\"><tr><td style=\"padding:19px;text-align:left;font-size:13px;color:#735970;line-height:1.9\"><b>♪ 나의 음악 선물</b><br>음악 감상 · 가사 확인 · 반복 재생<br>원본 음원과 상업적 이용: 별도 10,000원</td></tr></table><a href=\"%%LINK%%\" style=\"display:inline-block;text-decoration:none;background:#8c5978;color:#fff;font-size:15px;font-weight:bold;border-radius:30px;padding:15px 32px;margin:12px 0\">받은 음악 선물 열어보기</a><p style=\"font-size:12px;color:#9a8796;line-height:1.8;margin-top:24px\">공유하고 싶은 소중한 사람에게 이 링크를 전달해도 좋아요.<br>링크를 받은 사람은 해당 주문의 노래를 감상할 수 있습니다.</p></td></tr><tr><td align=\"center\" style=\"padding:22px 18px;border-top:1px solid #f0e7ed;font-size:11px;color:#9c8b99\">WITHU · 당신의 마음이 노래가 되는 순간.</td></tr></table></td></tr></table></body></html>".replace('%%LINK%%',escapeHtml(listeningUrl));
 return Object.freeze({subject,text,html});
}

/** Receipt email is not a completed-song notice. */
export function composeOrderReceivedEmail({statusUrl}={}){
 if(typeof statusUrl!=='string'||!/^https:\/\//.test(statusUrl))
  throw Error('HTTPS order status link required');
 const subject='WITHU · 노래 선물 주문이 접수됐어요';
 const text='결제가 확인됐어요.\n진행 상태 확인: '+statusUrl+
  '\n제작·검수 후 별도의 완성된 노래 감상 링크를 보내드려요. 주문 링크는 다른 사람에게 공유하지 마세요.\nWITHU';
 const html='<!doctype html><html lang="ko"><meta charset="utf-8">'+
  '<body style="font-family:Arial,sans-serif;background:#f5edf1;padding:30px">'+
  '<main style="margin:auto;max-width:560px;background:white;padding:35px;border-radius:18px">'+
  '<p style="letter-spacing:3px">WITHU · MUSIC LETTER</p><h1>노래 선물 주문이 접수됐어요.</h1>'+
  '<p>결제가 확인됐어요. 주문 진행 상태를 확인하고, 검수 후 별도 이메일로 노래를 감상할 수 있어요.</p>'+
  '<a style="background:#8c5978;color:white;padding:15px 26px;border-radius:30px;display:inline-block;text-decoration:none" href="'+escapeHtml(statusUrl)+'">내 주문 진행 상황 보기</a>'+
  '<p style="font-size:12px;color:#777">이 주문 확인 링크는 다른 사람에게 공유하지 마세요.</p>'+
  '</main></body>';
 return {subject,text,html};
}
