/* Authenticated end-to-end encrypted fallback for signed control packets.
 * The directory only routes opaque envelopes; ephemeral keys are signed by
 * the same persistent identities used to authenticate direct WebRTC links. */
(function(global){
  'use strict';
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const b64=bytes=>{let text='';for(const byte of new Uint8Array(bytes))text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  const unb64=text=>{if(typeof text!=='string'||text.length>196608||!/^[A-Za-z0-9_-]+$/.test(text))throw new Error('无效的中转数据');return Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));};
  const keyId=key=>key?.kty==='EC'&&key.crv==='P-256'&&!key.d&&typeof key.x==='string'&&key.x.length<=128&&typeof key.y==='string'&&key.y.length<=128?key.x+'.'+key.y:'';
  function create({engine,emit,send,getLocalId,isDirectConnected}){
    const sessions=new Map();
    let nextSendAt=0;
    function close(s,notify=true){
      if(!s||s.closed)return;
      if(notify&&s.authenticated&&s.remoteNonce){
        void engine().makePacket('relay-close',{sessionId:s.id,from:getLocalId(),to:s.target,nonce:s.remoteNonce}).then(packet=>send({type:'RELAY',target:s.target,sessionId:s.id,frame:{type:'close',packet}})).catch(()=>{});
      }
      s.closed=true;clearTimeout(s.timer);sessions.delete(s.id);
      if(s.authenticated&&!isConnected(s.peerId)&&!isDirectConnected(s.peerId))Promise.resolve(engine().peerOffline(s.peerId)).catch(()=>{});
    }
    function wire(s,frame){if(s.closed)throw new Error('中转连接已关闭');send({type:'RELAY',target:s.target,sessionId:s.id,frame});}
    function make(peer,id){
      if(sessions.size>=128)throw new Error('中转连接数量已达上限');
      const s={id,target:peer.id,peerId:peer.identityId,ip:peer.ip,closed:false,authenticated:false,nonce:crypto.randomUUID(),chain:Promise.resolve(),count:0};
      if(!/^[a-f0-9]{64}$/.test(s.peerId||''))throw new Error('对方未提供可验证的中转身份');
      sessions.set(id,s);s.timer=setTimeout(()=>{close(s);emit('error',{message:'服务器中转身份验证超时，请刷新发现'});},20000);
      s.ready=(async()=>{
        s.keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
        s.publicKey=await crypto.subtle.exportKey('jwk',s.keys.publicKey);
        const packet=await engine().makePacket('relay-hello',{sessionId:id,from:getLocalId(),to:s.target,nonce:s.nonce,publicKey:s.publicKey});
        s.localIdentity=packet.identity;wire(s,{type:'hello',packet});
      })();
      s.ready.catch(()=>close(s));return s;
    }
    function find(target){return [...sessions.values()].find(s=>s.target===target&&!s.closed);}
    async function connect(peer,id=crypto.randomUUID()){
      const existing=find(peer.id);if(existing)return existing;
      const s=make(peer,id);await s.ready;return s;
    }
    async function receive(message){
      const {peer,sessionId,frame}=message;
      if(!peer?.id||typeof sessionId!=='string'||!sessionId.length||sessionId.length>80||!frame)return;
      let s=sessions.get(sessionId);
      if(!s){
        if(frame.type!=='hello'||isDirectConnected(peer.identityId))return;
        const previous=find(peer.id);
        if(previous){if(previous.authenticated||previous.id<sessionId)return;close(previous);}
        s=make(peer,sessionId);
      }
      if(s.target!==peer.id||s.peerId!==peer.identityId||s.closed)return;
      if(s.count>=64){close(s);return;}s.count++;
      s.chain=s.chain.then(async()=>{
        await s.ready;if(s.closed)return;
        if(frame.type==='hello'&&!s.remoteIdentity){
          const packet=frame.packet,payload=packet?.payload;
          if(!await engine().verifyPacket(packet,s.peerId)||packet.type!=='relay-hello'||payload?.sessionId!==s.id||payload.from!==s.target||payload.to!==getLocalId()||typeof payload.nonce!=='string'||payload.nonce.length>80||!keyId(payload.publicKey))throw new Error('中转身份或密钥验证失败');
          s.remoteIdentity=packet.identity;s.remoteKey=payload.publicKey;s.remoteNonce=payload.nonce;
          const publicKey=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:s.remoteKey.x,y:s.remoteKey.y},{name:'ECDH',namedCurve:'P-256'},false,[]);
          s.secret=await crypto.subtle.deriveKey({name:'ECDH',public:publicKey},s.keys.privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
          const proof=await engine().makePacket('relay-proof',{sessionId:s.id,from:getLocalId(),to:s.target,nonce:payload.nonce,localKey:s.publicKey,remoteKey:s.remoteKey});
          wire(s,{type:'auth',packet:proof});
        }else if(frame.type==='auth'&&s.remoteIdentity&&!s.authenticated){
          const packet=frame.packet,payload=packet?.payload;
          if(!await engine().verifyPacket(packet,s.peerId)||packet.type!=='relay-proof'||payload?.sessionId!==s.id||payload.from!==s.target||payload.to!==getLocalId()||payload.nonce!==s.nonce||keyId(payload.localKey)!==keyId(s.remoteKey)||keyId(payload.remoteKey)!==keyId(s.publicKey))throw new Error('中转通道验证失败');
          s.authenticated=true;
          const result=await engine().peerOnline({identity:packet.identity,authenticated:true,ip:s.ip||'',reconnectable:true,connection:'relay'});
          if(result?.ok===false)throw new Error('对方已被屏蔽');
          clearTimeout(s.timer);emit('peer-online',{peerId:s.peerId,connection:'relay'});
        }else if(frame.type==='close'&&s.remoteIdentity){
          const packet=frame.packet,payload=packet?.payload;
          if(!await engine().verifyPacket(packet,s.peerId)||packet.type!=='relay-close'||payload?.sessionId!==s.id||payload.from!==s.target||payload.to!==getLocalId()||payload.nonce!==s.nonce)throw new Error('无效的中转关闭信息');
          close(s,false);
        }else if(frame.type==='data'&&s.authenticated){
          const iv=unb64(frame.iv);if(iv.length!==12)throw new Error('无效的中转随机数');
          const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${s.id}|${s.peerId}|${s.localIdentity.id}`)},s.secret,unb64(frame.data));
          const packet=JSON.parse(decoder.decode(bytes));
          await engine().handlePeerPacket(s.peerId,packet);
        }else throw new Error('无效或未认证的中转消息');
      }).catch(error=>{close(s);emit('error',{message:error.message});}).finally(()=>{s.count--;});
      return s.chain;
    }
    function isConnected(peerId){return [...sessions.values()].some(s=>s.peerId===peerId&&s.authenticated&&!s.closed);}
    async function sendPeer(peerId,packet){
      const s=[...sessions.values()].find(s=>s.peerId===peerId&&s.authenticated&&!s.closed);
      if(!s)throw new Error('对方尚未通过中转连接');
      const bytes=encoder.encode(JSON.stringify(packet));if(bytes.length>131072)throw new Error('中转消息过大');
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(`${s.id}|${s.localIdentity.id}|${s.peerId}`)},s.secret,bytes);
      const frame={type:'data',iv:b64(iv),data:b64(data)};
      // Shared per-socket pacing bounds queues and stays below the server's
      // byte budget, including simultaneous file transfers and group fanout.
      const now=Date.now(),wait=Math.max(0,nextSendAt-now);
      if(wait>5000)throw new Error('中转发送队列繁忙，请稍后重试');
      nextSendAt=Math.max(now,nextSendAt)+encoder.encode(JSON.stringify(frame)).length/512000*1000;
      if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
      wire(s,frame);
    }
    return {connect,receive,sendPeer,isConnected,closePeer:target=>{for(const s of [...sessions.values()])if(s.target===target||s.peerId===target)close(s);},close:()=>{for(const s of [...sessions.values()])close(s);}};
  }
  global.BjtuChatroomRelay={create};
})(globalThis);
