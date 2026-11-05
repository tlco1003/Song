/* WITHU public sample lyrics: genuine line cues, never elapsed-time guessing. */
const CUE_RE=/^\[(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?\]\s*(.*)$/u;

export function filterLyricLines(text){
 return String(text||'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(s=>{
  if(!s)return false;
  // A timestamp with no lyric text is invalid sync data, not a section heading.
  if(/^\[[^\]]*\]$/u.test(s)&&!/^\[\d{1,3}:\d{2}(?:\.\d{1,3})?\]$/u.test(s))return false;
  if(/^(?:version|버전)\s*\d+\s*\]?$/iu.test(s))return false;
  if(/^(?:verse(?:\s*\d+)?|chorus|pre[- ]?chorus(?:\s*\d+)?|bridge|intro|outro|finale|refrain|instrumental|interlude|repeat|반복|브릿지|인트로|아웃트로|간주)\s*\]?$/iu.test(s))return false;
  if(/^(?:\/\/|#)\s*(?:version|verse|chorus|bridge|반복|브릿지)/iu.test(s))return false;
  return true;
 });
}

/**
 * An untimed TXT is intentionally NOT treated as synchronized.
 * An LRC-style TXT only becomes synchronized if EVERY displayed line
 * carries a strictly increasing, valid start timestamp.
 */
export function parseLyricDocument(text){
 const input=filterLyricLines(text);
 const lines=[],possible=[];
 let fullyTimed=input.length>0;
 for(const line of input){
  const match=CUE_RE.exec(line);
  if(!match||!match[4].trim()){
   lines.push(line);
   possible.push(null);
   fullyTimed=false;
   continue;
  }
  const mins=Number(match[1]),secs=Number(match[2]);
  const fraction=match[3]?Number('0.'+match[3]):0;
  const at=mins*60+secs+fraction;
  lines.push(match[4].trim());
  possible.push(at);
 }
 if(fullyTimed){
  for(let i=0;i<possible.length;i++){
   if(!Number.isFinite(possible[i])||possible[i]<0||(i>0&&possible[i]<=possible[i-1])){
    fullyTimed=false;break;
   }
  }
 }
 return {lines,cues:fullyTimed?possible:null};
}

/** Find the last actually started lyric, or -1 during an intro/before first cue. */
export function cueIndexAt(cues,seconds){
 if(!Array.isArray(cues)||!cues.length||!Number.isFinite(seconds)||seconds<0)return -1;
 let lo=0,hi=cues.length-1,result=-1;
 while(lo<=hi){
  const mid=(lo+hi)>>1;
  if(cues[mid]<=seconds){result=mid;lo=mid+1}else hi=mid-1;
 }
 return result;
}

export function formatCueTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0||seconds>5999.99)throw new RangeError('Time outside supported song duration');
 const hundredths=Math.round(seconds*100);
 const mins=Math.floor(hundredths/6000);
 const sec=Math.floor((hundredths%6000)/100);
 const cs=hundredths%100;
 return '['+String(mins).padStart(2,'0')+':'+String(sec).padStart(2,'0')+'.'+String(cs).padStart(2,'0')+']';
}

/** Export a timestamped TXT for the existing song's lyricsFile path. */
export function serializeTimedLyrics(lines,times){
 if(!Array.isArray(lines)||!Array.isArray(times)||!lines.length||lines.length!==times.length)throw new TypeError('All lyric lines require a start time');
 let prev=-1;
 return lines.map((line,i)=>{
  const value=String(line||'').trim(),at=times[i];
  if(!value||!Number.isFinite(at)||at<0||at>5999.99)throw new TypeError('Missing or invalid lyric time at line '+(i+1));
  const rounded=Math.round(at*100)/100;
  if(rounded<=prev)throw new RangeError('Cue times must be increasing at line '+(i+1));
  prev=rounded;
  return formatCueTime(rounded)+value;
 }).join('\n')+'\n';
}
