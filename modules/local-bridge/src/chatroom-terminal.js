import readline from 'node:readline';

// Discovery metadata is untrusted: never let names/accounts inject terminal codes.
const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ');
const segments=new Intl.Segmenter('zh',{granularity:'grapheme'});
function width(text){
  if(/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text))return 2;
  const cp=text.codePointAt(0);
  return /\p{Mark}/u.test(text[0])?0:cp>=0x1100&&(cp<=0x115f||cp>=0x2e80&&cp<=0xa4cf||cp>=0xac00&&cp<=0xd7a3||cp>=0xf900&&cp<=0xfaff||cp>=0xfe10&&cp<=0xfe6f||cp>=0xff00&&cp<=0xff60||cp>=0x20000)?2:1;
}
function wrap(text,columns){
  const result=[];let line='',used=0;
  for(const {segment}of segments.segment(text)){
    const size=width(segment);if(used+size>columns&&line){result.push(line);line='';used=0;}
    line+=segment;used+=size;
  }
  result.push(line);return result;
}
export function createChatroomTerminal(output=process.stdout){
  let rows=0,peers=[],last='',closed=false;
  function erase(){
    if(!output.isTTY||!rows)return;
    readline.moveCursor(output,0,-rows);readline.cursorTo(output,0);readline.clearScreenDown(output);rows=0;
  }
  function render(force=false){
    if(closed)return;
    const users=new Map();for(const peer of peers)users.set(peer.identityId||peer.id,peer);
    const sorted=[...users.values()].sort((a,b)=>String(a.ip).localeCompare(String(b.ip))||String(a.identityId||a.id).localeCompare(String(b.identityId||b.id)));
    const lines=[`在线用户：${sorted.length}`];
    for(const [index,peer]of sorted.entries()){
      lines.push(`${index+1}. ${clean(peer.alias)||clean(peer.ip)||'未命名用户'} · ${clean(peer.ip)||'IP 未知'}`);
      const details=[];
      if(peer.accounts?.ve)details.push(`智慧课程平台${peer.accounts.veRecent?'（最近登录）':''}：${clean(peer.accounts.ve)}`);
      if(peer.accounts?.mis)details.push(`MIS：${clean(peer.accounts.mis)}`);
      if(!peer.accounts?.ve&&!peer.accounts?.mis)details.push('账号信息尚未发布（旧版扩展需重新加载）');
      const device=[peer.device?.os,peer.device?.browser].filter(Boolean).map(clean).join(' · ');
      if(device)details.push(`设备：${device}`);
      if(peer.extensionVersion)details.push(`扩展版本：${clean(peer.extensionVersion)}`);
      lines.push('   '+(details.join('；')||'等待设备发布账号及版本信息'));
    }
    const columns=output.isTTY?Math.max(4,(output.columns||80)-1):Infinity;
    const text=lines.flatMap(line=>wrap(line,columns)).join('\n')+'\n';
    if(!force&&last===text)return;
    erase();output.write(text);rows=text.split('\n').length-1;last=text;
  }
  const resize=()=>render(true);output.on?.('resize',resize);
  return {
    update(value){peers=value;render();},
    log(message){erase();output.write(clean(message)+'\n');render(true);},
    close(){closed=true;output.off?.('resize',resize);}
  };
}
