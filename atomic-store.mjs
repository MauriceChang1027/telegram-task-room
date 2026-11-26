import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
const backoff=[8,16,32,64,96,128,160,200,250];
export function atomicWriteJSON(file,data,{io=fs,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 const content=JSON.stringify(data,null,2);io.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+process.pid+'.'+randomUUID()+'.tmp';
 try{io.writeFileSync(temporary,content,{encoding:'utf8',mode:0o600,flag:'wx'});
  for(let attempt=0;;attempt++){try{io.renameSync(temporary,file);return;}catch(e){if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=backoff.length)throw e;wait(backoff[attempt]);}}
 }catch(cause){const error=new Error('本機紀錄暫時不能保存；原檔和待恢復版本已保留。',{cause});error.code='STORE_WRITE_BLOCKED';error.pendingFile=temporary;throw error;}
}
