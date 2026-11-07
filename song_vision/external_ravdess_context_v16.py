"""Real v16 feasibility study. Two neutral sentences CANNOT teach broad meaning.

Official transcript is only whole-clip context. Word boundaries, psychological
meaning and four-dimensional affect targets are never fabricated from it.
"""
import argparse
import json
import os
import tempfile
from pathlib import Path
from .external_ravdess_intensity_v12 import (ACTORS,select_condition_balanced_singing,make_v12_manifest)
from .external_ravdess_multisinger import download_official_actor_zip,RECORD_URL
from .real_training import prepare_manifest
from .face_surface_motion import annotate_face_surface_dataset
from .staged_face_v13 import train_staged
from .contextual_training_v16 import train_contextual
from .contextual_audit_v16 import audit_contextual
from .contextual_face_v16 import MODEL_VERSION
from .research_vault_v15 import seal_study_model
from .word_feelings_v15 import fetch_original_word_norms,train_word_meanings
from .korean_context_pretrain_v15 import download_reviews,train_contextual_korean

TRANSCRIPTS={'01':'Kids are talking by the door','02':'Dogs are sitting by the door'}
TRANSCRIPT_SOURCE='https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0196391'


def attach_official_context(prepared):
    for path in prepared.glob('*/*/index.json'):
        data=json.loads(path.read_text()); parts=data['clipId'].split('-')
        if len(parts)!=8 or parts[:3]!=['ravdess','01','02'] or parts[5] not in TRANSCRIPTS:
            raise ValueError('Only verified RAVDESS song identifiers accepted')
        doc=dict(schemaVersion=1,text=TRANSCRIPTS[parts[5]],
                 vocalSha256=data['sourceVocalsSha256'],timeBase='vocal_file_seconds',
                 durationSeconds=float(data['frames'][-1]['seconds'])+.04,
                 transcriptSource='official_corpus_statement',source=TRANSCRIPT_SOURCE,
                 words=[],expressionIntervals=[])
        (path.parent/'lyrics-context-v16.json').write_text(json.dumps(doc,indent=2))


def run(teacher,public_key,vault,epochs=2):
    if vault.exists() and any(vault.iterdir()): raise FileExistsError('Preserve prior archived weights')
    with tempfile.TemporaryDirectory(prefix='song-v16-private-study-') as tmp:
        root=Path(tmp); takes=[]; checksums={}
        word_bytes,word_sha=fetch_original_word_norms(); word_checkpoint=root/'word-feelings-v15.pt'
        word_report=train_word_meanings(word_bytes,word_checkpoint,epochs=8)
        reviews_train,_=download_reviews('train'); reviews_val,_=download_reviews('holdout')
        contextual_words=root/'word-plus-sentence-context-v15.pt'
        context_report=train_contextual_korean(reviews_train,reviews_val,word_bytes,word_checkpoint,contextual_words,
                                               epochs=3,train_each=2500,holdout_each=400)
        for actor in ACTORS:
            archive=root/f'actor-{actor}.zip'
            checksums[actor]=download_official_actor_zip(actor,archive)
            takes.extend(select_condition_balanced_singing(archive,root,actor)); archive.unlink()
        # Build the validated source manifest first, then retain a balanced 24-clip pilot.
        manifest=make_v12_manifest(takes,root); content=json.loads(manifest.read_text())
        # Happy/sad, two strengths, two sentences, one repetition, three actors.
        chosen=[c for c in content['clips'] if c['id'].split('-')[3] in ('03','04') and c['id'].split('-')[6]=='01']
        if len(chosen)!=24: raise ValueError('Expected balanced 16 train + 8 unseen-actor clips')
        content['clips']=chosen; manifest.write_text(json.dumps(content))
        prepared=root/'prepared'; prepare_manifest(manifest,prepared,save_acoustic_cues=True)
        annotate_face_surface_dataset(prepared,teacher,min_coverage=.80)
        attach_official_context(prepared)
        prior=root/'motion-v13.pt'
        train_staged(prepared,prior,epochs_per_stage=(1,1,1,1),batch_size=12)
        checkpoint=root/'contextual-v16.pt'
        report=train_contextual(prepared,checkpoint,epochs=epochs,batch_size=2,motion_checkpoint=prior,word_checkpoint=contextual_words)
        val=next(c for c in chosen if c['split']=='val')
        audit=audit_contextual(prepared,val['id'],root/val['vocals'],checkpoint,root/'PRIVATE-comparison')
        run_id=os.getenv('GITHUB_RUN_ID','operator'); attempt=os.getenv('GITHUB_RUN_ATTEMPT','1')
        sealed=seal_study_model(checkpoint,checkpoint.with_suffix('.report.json'),public_key,
                    vault/f'song-v16-context-run-{run_id}-a{attempt}.svault',
                    dataset='RAVDESS-AND-KOREAN-WORD-NORMS-CONTEXTUAL-V16',run_id=f'{run_id}-a{attempt}')
        summary=dict(modelVersion=MODEL_VERSION,trainClips=16,valClips=8,distinctTexts=2,
                     transcriptSource=TRANSCRIPT_SOURCE,license='CC-BY-NC-SA-4.0',
                     training=report,lexicalTraining=word_report,koreanSentenceTraining=context_report,pairedSameAudioAudit=audit,encryptedCheckpoint=sealed,
                     semanticGeneralizationValidated=False,privateMediaUploaded=False)
        (vault/'v16-real-study-summary.manifest.json').write_text(json.dumps(summary,indent=2))
        print('SONG_V16_REAL_STUDY='+json.dumps(summary,sort_keys=True),flush=True)
        return summary


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--landmarker-task',type=Path,required=True); p.add_argument('--vault-public-key',type=Path,required=True)
    p.add_argument('--vault-output-dir',type=Path,required=True); p.add_argument('--epochs',type=int,default=2)
    p.add_argument('--acknowledge-noncommercial-research',action='store_true'); args=p.parse_args()
    if not args.acknowledge_noncommercial_research: p.error('Noncommercial RAVDESS study required')
    run(args.landmarker_task,args.vault_public_key,args.vault_output_dir,args.epochs)

if __name__=='__main__': main()
