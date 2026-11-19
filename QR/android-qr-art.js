/* BJTUCA's download-label artwork. QR encoding remains exclusively in the remote QR-Art page. */
(function defineAndroidQrArtwork(global) {
  'use strict';
  const font = {
    '0':[62,81,73,69,62],'1':[0,66,127,64,0],'2':[66,97,81,73,70],'3':[33,65,69,75,49],
    '4':[24,20,18,127,16],'5':[39,69,69,69,57],'6':[60,74,73,73,48],'7':[1,113,9,5,3],
    '8':[54,73,73,73,54],'9':[6,73,73,41,30],
    A:[126,17,17,17,126],B:[127,73,73,73,54],C:[62,65,65,65,34],D:[127,65,65,34,28],
    E:[127,73,73,73,65],F:[127,9,9,9,1],G:[62,65,73,73,122],H:[127,8,8,8,127],
    I:[0,65,127,65,0],J:[32,64,65,63,1],K:[127,8,20,34,65],L:[127,64,64,64,64],
    M:[127,2,12,2,127],N:[127,4,8,16,127],O:[62,65,65,65,62],P:[127,9,9,9,6],
    Q:[62,65,81,33,94],R:[127,9,25,41,70],S:[70,73,73,73,49],T:[1,1,127,1,1],
    U:[63,64,64,64,63],V:[31,32,64,32,31],W:[63,64,56,64,63],X:[99,20,8,20,99],
    Y:[7,8,112,8,7],Z:[97,81,73,69,67],
    a:[32,84,84,84,120],b:[127,72,68,68,56],c:[56,68,68,68,32],d:[56,68,68,72,127],
    e:[56,84,84,84,24],f:[8,126,9,1,2],g:[12,82,82,82,62],h:[127,8,4,4,120],
    i:[0,68,125,64,0],j:[32,64,68,61,0],k:[127,16,40,68,0],l:[0,65,127,64,0],
    m:[124,4,24,4,120],n:[124,8,4,4,120],o:[56,68,68,68,56],p:[124,20,20,20,8],
    q:[8,20,20,24,124],r:[124,8,4,4,8],s:[72,84,84,84,32],t:[4,63,68,64,32],
    u:[60,64,64,32,124],v:[28,32,64,32,28],w:[60,64,48,64,60],x:[68,40,16,40,68],
    y:[12,80,80,80,60],z:[68,100,84,76,68],
    '.':[0,96,96,0,0],'/':[32,16,8,4,2],'-':[8,8,8,8,8],'_':[64,64,64,64,64],
    ':':[0,54,54,0,0],'?':[2,1,81,9,6],'=':[20,20,20,20,20],'&':[54,73,85,34,80],
    '%':[99,19,8,100,99],'#':[20,127,20,127,20],'~':[8,4,8,16,8],' ':[0,0,0,0,0]
  };
  let cachedText = null, cachedFrames = null;
  function createConfig(text, {animate = true, speed = 1} = {}) {
    // These dimensions and the bitmap font are BJTUCA presentation choices, not QR-Art defaults.
    const x = 11, y = 0, width = 12, height = 37;
    if (text !== cachedText) {
      const label = String(text).replace(/^https?:\/\//i, '');
      const lines = [];
      for (let index=0;index<label.length;index+=2) lines.push(label.slice(index,index+2));
      const tapeHeight = lines.length*8+16, frames = [];
      for (let step=0;step<tapeHeight;step++) {
        let pixels = '';
        for (let row=0;row<height;row++) for(let column=0;column<width;column++) {
          const sourceY = (row+step)%tapeHeight, line = lines[Math.floor(sourceY/8)], glyphRow = sourceY%8;
          const sourceX = column-1; // Offset only the text, keeping the artwork rectangle fixed.
          const char = sourceX >= 0 ? line?.[Math.floor(sourceX/6)] : undefined;
          const glyph = font[char] || font['?'];
          const dark = char && glyphRow<7 && sourceX%6<5 ? (glyph[sourceX%6]>>glyphRow)&1 : 0;
          pixels += dark ? '1' : '0';
        }
        frames.push(pixels);
      }
      cachedText = text; cachedFrames = frames;
    }
    speed = Number(speed);
    if (!Number.isFinite(speed) || speed<=0) speed = 1;
    return {text,encoding:'Byte',version:5,ecc:'L',mask:7,moduleSize:8,margin:8,
      foreground:'#000000',background:'#ffffff',moduleScale:1,moduleShape:'square',paddingBackground:0,animate,
      art:{x,y,width,height,frames:cachedFrames,frameDuration:Math.min(60000,Math.max(16,180/speed)),loop:true}};
  }
  global.BjtuAndroidQrArtwork = Object.freeze({createConfig});
})(globalThis);
