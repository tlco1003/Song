import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AppError} from './lib.mjs';

const exec = promisify(execFile);
const max = 45_000_000;

export function pickStems(entries) {
  // Entries from ZIP central directory, not arbitrary paths chosen by the user.
  const files=entries.filter(x=>/\.mp3$/i.test(x) && !x.startsWith('__MACOSX/'));
  const vocal=files.find(x=>/(^|[/_ .()-])vocals?([_ .()-]|$)/i.test(x) && !/(no[_ -]?vocals|instrumental|without[_ -]?vocals)/i.test(x));
  const instrumental=files.find(x=>/(instrumental|accompaniment|no[_ -]?vocals|without[_ -]?vocals)/i.test(x));
  if(!vocal || !instrumental || vocal === instrumental) throw new AppError(502,'분리 API 결과에서 보컬과 반주 파일을 식별하지 못했습니다.');
  return {vocal,instrumental};
}

export async function unzipStems(zipBytes) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'song-stems-'));
  const zipPath=path.join(dir,'stems.zip');
  try {
    await writeFile(zipPath,zipBytes,{mode:0o600});
    const {stdout} = await exec('unzip',['-Z','-1',zipPath],{maxBuffer:500_000,timeout:20_000});
    const entries=stdout.trim().split(/\r?\n/);
    const {vocal,instrumental}=pickStems(entries);
    const [v,i]=await Promise.all([vocal,instrumental].map(async name=>{
      const r=await exec('unzip',['-p',zipPath,name],{encoding:'buffer',maxBuffer:max,timeout:30_000});
      return Buffer.from(r.stdout);
    }));
    if (v.length<1024 || i.length<1024) throw new AppError(502,'분리된 보컬 또는 반주가 비어 있습니다.');
    return {vocals:v,instrumental:i};
  } finally {await rm(dir,{recursive:true,force:true});}
}

async function duration(file) {
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{timeout:20_000});
  const d=Number(stdout.trim());
  if (!Number.isFinite(d) || d<=0) throw new AppError(502,'오디오 길이를 분석할 수 없습니다.');
  return d;
}

export async function mixVocals(instrumental,originalVocals,convertedVocals) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'song-mix-'));
  const files=['instrumental.mp3','original.mp3','converted.mp3','final.mp3'].map(n=>path.join(dir,n));
  try {
    await Promise.all([instrumental,originalVocals,convertedVocals].map((bytes,i)=>writeFile(files[i],bytes,{mode:0o600})));
    const [sourceDuration,convertedDuration]=await Promise.all([duration(files[1]),duration(files[2])]);
    if (Math.abs(sourceDuration-convertedDuration)>Math.max(1.25,sourceDuration*0.07)) {
      throw new AppError(422,`변환 전후 보컬 길이 차이(${sourceDuration.toFixed(1)}초 → ${convertedDuration.toFixed(1)}초)가 커서 믹싱을 중단했습니다.`);
    }
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',files[0],'-i',files[2],
      '-filter_complex','[0:a]volume=1.0[a];[1:a]volume=0.96[b];[a][b]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95[out]',
      '-map','[out]','-codec:a','libmp3lame','-q:a','3',files[3]],{timeout:90_000,maxBuffer:100_000});
    const mixed=await readFile(files[3]);
    if(mixed.length<1024) throw new AppError(502,'믹싱 결과가 비어 있습니다.');
    return mixed;
  } catch(e) { if(e instanceof AppError) throw e; throw new AppError(502,'FFmpeg 믹싱에 실패했습니다. ffmpeg/ffprobe 설치와 오디오 형식을 확인하세요.'); }
  finally {await rm(dir,{recursive:true,force:true});}
}
