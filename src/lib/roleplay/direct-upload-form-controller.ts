import { directInterpreterAssignment, type DirectInterpreterAssignment } from './direct-upload-interpreter-assignment';
import { DirectUploadReviewRequired, type DirectUploadProgress } from './direct-upload-browser-resume';

export type FormProgress = {phase:DirectUploadProgress['phase']|'consolidating'|'publishing'|'published'; verified:number; consolidated:number; total:number};
type Options = {signal?:AbortSignal; onProgress?:(p:FormProgress)=>void};
type Receipt = {sessionId:string; scenarioCount:number; inviteLink:string};
type Port = {
  upload(options:{signal?:AbortSignal;onProgress?:(p:DirectUploadProgress)=>void}):Promise<{requestKey:string;verifiedCount:number;total:number}>;
  consolidate(key:string,order:number,signal?:AbortSignal):Promise<unknown>;
  publish(key:string,assignment:DirectInterpreterAssignment,total:number,signal?:AbortSignal):Promise<Receipt>;
};

/** The frozen assignment and upload controller survive a same-tab retry.
 * Never start a different reservation or fallback to legacy multipart. */
export function createDirectRoleplayFormController(input:unknown,port:Port) {
  const assignment=directInterpreterAssignment.parse(input);
  const total=assignment.scenarios.length;
  let requestKey:string|undefined, verified=0, consolidated=0, active=false;
  let receipt:Receipt|undefined;
  async function run(options:Options={}) {
    if(active) throw new Error('ROLEPLAY_OPERATION_ACTIVE');
    active=true;
    const check=()=>{if(options.signal?.aborted) throw new Error('ROLEPLAY_OPERATION_INTERRUPTED');};
    const emit=(phase:FormProgress['phase'])=>{options.onProgress?.({phase,verified,consolidated,total});check();};
    try {
      check();
      if(receipt) return {...receipt};
      if(!requestKey){
        const result=await port.upload({signal:options.signal,onProgress:p=>{verified=p.verified;emit(p.phase);}});
        if(result.total!==total || result.verifiedCount!==total || !/^[a-f0-9-]{36}$/.test(result.requestKey)) throw new Error();
        requestKey=result.requestKey;
        verified=total;
      }
      while(consolidated<total){
        emit('consolidating');
        const result=await port.consolidate(requestKey,consolidated,options.signal);
        check();
        if(!result || typeof result!=='object') throw new Error();
        const p=result as Record<string,unknown>;
        if(p.total!==total || typeof p.verifiedCount!=='number' || !Number.isSafeInteger(p.verifiedCount) ||
            p.verifiedCount<=consolidated || p.verifiedCount>total || p.complete!==(p.verifiedCount===total)) throw new Error();
        consolidated=p.verifiedCount;
      }
      emit('publishing');
      const result=await port.publish(requestKey,assignment,total,options.signal);
      if(result.scenarioCount!==total || !result.sessionId || !result.inviteLink) throw new Error();
      receipt={...result};
      emit('published');
      return {...receipt};
    } catch (error) {
      try {options.onProgress?.({phase:'interrupted',verified,consolidated,total});} catch { /* no sensitive details */ }
      if (error instanceof DirectUploadReviewRequired) throw error;
      throw new Error('ROLEPLAY_DIRECT_OPERATION_INTERRUPTED');
    } finally {active=false;}
  }
  return {run};
}
