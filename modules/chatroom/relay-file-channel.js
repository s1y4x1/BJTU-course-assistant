/* RTCDataChannel-shaped, bounded file fallback over authenticated signals. */
(function(global){
  'use strict';
  class RelayFileChannel extends EventTarget {
    constructor(send){super();this.sendFrame=send;this.readyState='connecting';this.bufferedAmount=0;this.bufferedAmountLowThreshold=65536;this.queue=Promise.resolve();}
    open(){if(this.readyState!=='connecting')return;this.readyState='open';this.onopen?.(new Event('open'));}
    send(value){
      if(this.readyState!=='open')throw new Error('文件中转连接尚未打开');
      const binary=value instanceof ArrayBuffer;
      if(!binary&&typeof value!=='string')throw new Error('无效的文件数据');
      const size=binary?value.byteLength:new TextEncoder().encode(value).length;
      if(size>(binary?32768:1024)||this.bufferedAmount+size>262144)throw new Error('文件中转发送队列过大');
      const data=binary?btoa(String.fromCharCode(...new Uint8Array(value))):value;
      this.bufferedAmount+=size;
      this.queue=this.queue.then(async()=>{if(this.readyState==='closed')throw new Error('文件传输已关闭');await this.sendFrame({binary,data});}).then(()=>{
        this.bufferedAmount-=size;if(this.bufferedAmount<=this.bufferedAmountLowThreshold)this.dispatchEvent(new Event('bufferedamountlow'));
      }).catch(error=>{if(this.readyState!=='closed'){this.onerror?.({error});this.close();}});
    }
    receive(frame){
      if(this.readyState==='closed'||typeof frame?.data!=='string'||typeof frame.binary!=='boolean')return;
      let data=frame.data;
      if(frame.binary){
        if(this.readyState!=='open'||data.length>43692||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new Error('无效的文件中转分片');
        data=Uint8Array.from(atob(data),char=>char.charCodeAt(0)).buffer;
        if(!data.byteLength||data.byteLength>32768)throw new Error('文件中转分片过大');
      }else if(data.length>1024)throw new Error('文件中转控制信息过大');
      this.onmessage?.({data});
    }
    close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.(new Event('close'));this.dispatchEvent(new Event('close'));}
  }
  global.BjtuRelayFileChannel=RelayFileChannel;
})(globalThis);
