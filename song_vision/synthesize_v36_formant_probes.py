"""Original neutral glottal-harmonic sound demos, NOT correct synthesized Korean.

Uses v35 tongue + 1D duct response per 40-ms window. No real consonant
frication, closure release, nasal branch, clinical sound quality, or voice clone.
"""
from __future__ import annotations
from pathlib import Path
import json
import numpy as np,soundfile as sf
from owner_v35_articulatory_3d import vowel_pose
from owner_v36_acoustic_articulation import airway_from_pose,tube_frequency_response,formant_candidates

VOWELS=['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ']

def synthesize(duration=.52,fs=16000,f0=146.0):
    # Harmonic source and 1D tract spectrally shaping each time slice.
    pulse=[];manifest=[]
    for vowel in VOWELS:
        parts=[]
        # approximate smooth formant transition with 13 consecutive 40ms blocks
        nblocks=13;n=int(round(duration*fs/nblocks))
        start=0
        for j in range(nblocks):
            phase=(j+.5)/nblocks
            pose=vowel_pose(vowel,phase)
            profile=airway_from_pose(pose)
            harmonics=np.arange(1,int((fs/2-80)//f0)+1)
            hf=harmonics*f0
            _,amps=tube_frequency_response(profile,hf)
            # roll-off = arbitrary original voice-source illustration.
            amp=(.05+amps)**1.3/(harmonics**.85)
            tt=np.arange(n)/fs + start/fs
            wave=(amp[:,None]*np.sin((2*np.pi*hf[:,None])*tt[None,:])).sum(axis=0)
            start+=n
            parts.append(wave)
        x=np.concatenate(parts)
        x=x/(max(np.max(np.abs(x)),1e-8))*.53
        env=np.ones(len(x));fade=min(len(x)//8,int(fs*.04))
        env[:fade]=np.sin(np.linspace(0,np.pi/2,fade))**2
        env[-fade:]=np.cos(np.linspace(0,np.pi/2,fade))**2
        x=x*env
        pulse.extend(x.tolist());pulse.extend(np.zeros(int(.12*fs)))
        manifest.append({'vowel':vowel,'durationSec':len(x)/fs,'hypotheticalResonancesHz':formant_candidates(airway_from_pose(vowel_pose(vowel))),
            'phoneticValidityVerified':False,'voiceIsOwnerCloned':False})
    wave=np.asarray(pulse,np.float32)
    wave=np.clip(wave,-.95,.95)
    return wave,fs,manifest

if __name__=='__main__':
    p=Path(__file__).resolve().parent/'results';p.mkdir(exist_ok=True)
    wave,fs,manifest=synthesize()
    sf.write(p/'SONG_V36_ARTICULATORY_FORMANT_PROBES_NOT_KOREAN_TTS.wav',wave,fs)
    (p/'SONG_V36_SYNTHETIC_VOWEL_PROBE_REPORT.json').write_text(json.dumps({'note':'Original neutral synthetic formant experiments; NOT Korean speech or personal voice', 'vowels':manifest},ensure_ascii=False,indent=2))
    print('wrote',len(wave)/fs)
