import 'server-only';
import { execFile } from 'node:child_process';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { verifyRoleplayUploadByteStream } from './direct-upload-stream-verifier';
import type { PreparedRoleplayUpload } from './direct-upload-contract';
import { ROLEPLAY_RESPONSE_MAX_DURATION_SEC } from '@/lib/roleplay-limits';

const run=promisify(execFile);
const formats=new Map([['audio/mpeg','mp3'],['audio/wav','wav'],['audio/webm','matroska'],['audio/mp4','mov']]);
// Deliberate conservative pilot limit, separate from the response time setting.
export const MAX_DIRECT_CLINICAL_AUDIO_SEC=ROLEPLAY_RESPONSE_MAX_DURATION_SEC;
let decoding=false;

export function decodedClinicalDuration(progress:string) {
  if(!/(?:^|\n)progress=end\s*$/.test(progress)) throw new Error('AUDIO_DECODE_INVALID');
  const us=Number([...progress.matchAll(/^out_time_us=(\d+)\r?$/gm)].at(-1)?.[1]);
  if(!Number.isSafeInteger(us) || us<=0 || us>MAX_DIRECT_CLINICAL_AUDIO_SEC*1_000_000)
    throw new Error('AUDIO_DECODE_INVALID');
  return Math.ceil(us/1_000_000);
}

/** Verify and decode the same downloaded bytes. Never pass an untrusted path,
 * URL, decoder option or diagnostics to FFmpeg or back to the browser.
 * One temporary file, one decode per process, no output audio file. The
 * protocol/demuxer restrictions are defense-in-depth, not an OS sandbox. */
export async function verifyDecodedClinicalAudio(stream:ReadableStream<Uint8Array>,
  item:Pick<PreparedRoleplayUpload,'mime'|'sizeBytes'|'sha256'>,
  downloadSignal?:AbortSignal, requestSignal?:AbortSignal) {
  const format=formats.get(item.mime);
  if(!format || !ffmpegPath || decoding || requestSignal?.aborted || downloadSignal?.aborted){
    void stream.cancel().catch(()=>{});
    throw new Error('FINAL_AUDIO_DECODE_UNAVAILABLE');
  }
  decoding=true;
  let directory:string|undefined;
  try {
    directory=await mkdtemp(join(tmpdir(),'roleplay-final-'));
    const input=join(directory,'audio');
    const file=await open(input,'wx',0o600);
    let verified:Awaited<ReturnType<typeof verifyRoleplayUploadByteStream>>;
    try{
      verified=await verifyRoleplayUploadByteStream(stream,item,downloadSignal,async chunk=>{await file.writeFile(chunk);});
    }finally{await file.close();}
    if(requestSignal?.aborted) throw new Error();
    const {stdout}=await run(ffmpegPath,[
      '-hide_banner','-nostdin','-v','error','-xerror','-threads','1',
      '-max_alloc','67108864','-protocol_whitelist','file,pipe','-f',format,
      ...(format==='mov'?['-enable_drefs','0']:[]),
      '-i',input,'-map','0:a:0','-vn','-sn','-dn','-filter_threads','1',
      '-af','asetpts=N/SR/TB','-t',String(MAX_DIRECT_CLINICAL_AUDIO_SEC+1),
      '-progress','pipe:1','-nostats','-f','null','-',
    ],{timeout:45_000,killSignal:'SIGKILL',maxBuffer:256*1024,signal:requestSignal});
    if(requestSignal?.aborted) throw new Error();
    decodedClinicalDuration(stdout);
    return verified;
  }catch{
    if(!stream.locked) void stream.cancel().catch(()=>{});
    throw new Error('FINAL_AUDIO_DECODE_UNAVAILABLE');
  }finally{
    if(directory) await rm(directory,{recursive:true,force:true}).catch(()=>{});
    decoding=false;
  }
}
