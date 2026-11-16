/* Local pixel checks. Detects padding/intro flashes, not semantic/anatomy errors. */
(() => {
  function margins(pixels, width, height) {
    const whiteRow = y => {
      let white=0;
      for(let x=0;x<width;x++){const i=(y*width+x)*4;if(pixels[i]>=245&&pixels[i+1]>=245&&pixels[i+2]>=245)white++;}
      return white/width>=0.985;
    };
    let top=0,bottom=0;
    while(top<height&&whiteRow(top))top++;
    while(bottom<height-top&&whiteRow(height-1-bottom))bottom++;
    return {top:top/height,bottom:bottom/height,total:(top+bottom)/height};
  }
  function classify(first, later) {
    if(first.total>=0.22&&later.total<0.10)return {ok:false,code:'intro_flash',note:'Khung đầu có dải trắng lớn, khung sau chuyển sang đầy màn hình — nghi lộ ảnh tham chiếu.'};
    if(first.total>=0.22&&later.total>=0.22)return {ok:false,code:'white_padding',note:'Video có dải trắng lớn ở cả đầu và cảnh sau.'};
    return {ok:true,code:'passed',note:'Không phát hiện dải trắng lớn theo mẫu đã kiểm tra.'};
  }
  function pixelsOf(source) {
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(source,0,0,320,180);
    return margins(ctx.getImageData(0,0,320,180).data,320,180);
  }
  async function inspectImage(blob) {
    const image=await createImageBitmap(blob);
    try {
      const ratio=image.width/image.height;
      const edge=pixelsOf(image);
      return {ok:Math.abs(ratio-16/9)<=0.06&&edge.total<0.18,width:image.width,height:image.height,margins:edge};
    } finally {image.close();}
  }
  function event(target,name,action) {
    return new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);target.removeEventListener(name,done);target.removeEventListener('error',fail);document.removeEventListener('visibilitychange',onHidden);};
      const done=()=>{cleanup();resolve();};
      const fail=()=>{cleanup();reject(new Error('Không giải mã được media để kiểm tra khung hình.'));};
      const onHidden=()=>{if(document.hidden){cleanup();reject(new Error('Cửa sổ bị ẩn, hoãn kiểm tra video.'));}};
      document.addEventListener('visibilitychange',onHidden);
      target.addEventListener(name,done,{once:true});target.addEventListener('error',fail,{once:true});
      timer=setTimeout(()=>{cleanup();reject(new Error('Quá thời gian kiểm tra khung hình.'));},15000);
      try{action();}catch(e){cleanup();reject(e);}
    });
  }
  async function inspectVideo(blob) {
    const video=document.createElement('video');video.muted=true;video.preload='auto';video.playsInline=true;
    const url=URL.createObjectURL(blob);
    try {
      await event(video,'loadeddata',()=>{video.src=url;video.load();});
      if(!video.videoWidth||!Number.isFinite(video.duration)||video.duration<=0)throw Error('Video thiếu metadata hợp lệ.');
      const first=pixelsOf(video);
      await event(video,'seeked',()=>{video.currentTime=Math.min(0.15,video.duration/2);});
      const later=pixelsOf(video);
      return {...classify(first,later),first,later,width:video.videoWidth,height:video.videoHeight};
    } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
  }
  async function inspectWhenVisible(blob) {
    if (document.hidden) return {ok:null,code:'deferred',note:'Đã lưu video; chờ mở Studio để kiểm tra khung hình.'};
    try {return await inspectVideo(blob);}
    catch(e) {return {ok:null,code:document.hidden?'deferred':'check_unavailable',note:`Video đã lưu nhưng chưa kiểm tra được: ${e.message}`};}
  }
  globalThis.MuseFrameQuality=Object.freeze({margins,classify,inspectImage,inspectVideo,inspectWhenVisible});
})();
