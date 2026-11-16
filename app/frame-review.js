/* Review saved blobs only while visible. Never re-generates a video by itself. */
(() => {
  const node=id=>document.getElementById(id);
  let reviewing=false;
  async function review(force=false) {
    if(reviewing||document.hidden||isBusy()||globalThis.museImportBusy)return;
    reviewing=true;globalThis.museReviewBusy=true;
    const pid=state.pid;
    try {
      const pending=state.scenes.filter(sc=>sc.frameCheck?.code==='deferred'||(force&&sc.frameCheck?.code==='check_unavailable'));
      for(const sc of pending) {
        if(document.hidden||state.pid!==pid)break;
        const file=sc.files?.at(-1);if(!file)continue;
        const key=vidKey(zipEntryName(file));
        const blob=await idb.get(key,'videos');if(!blob)continue;
        const check=await MuseFrameQuality.inspectWhenVisible(blob);
        if(state.pid!==pid)break;
        sc.frameCheck=check;
        if(check.ok===false) {
          const rejected=`rejected/c${pad(sc.n)}.mp4`;
          await idb.put(vidKey(rejected),blob,'videos');
          await idb.del(key,'videos');
          sc.files=sc.files.filter(f=>f!==file);
          sc.rejectedFile=rejected;sc.inZip=false;sc.status='error';sc.errorKind='frame';sc.retryable=true;
          sc.reason=`Kiểm tra video đã lưu: ${check.note} Chưa tự tạo lại; bấm Tiếp tục hoặc Làm lại khi muốn thử lại.`;
        }
        if(check.code==='deferred')break;
      }
      if(state.pid===pid){await save();render();}
    } finally {reviewing=false;globalThis.museReviewBusy=false;update();}
  }
  function recoverable(sc){return sc.status==='error'&&/Chưa xác minh được khung hình video|Ô nhập đang có ảnh chưa gửi|Không xác nhận được ảnh|Không còn đủ ảnh tham chiếu/.test(sc.reason||'');}
  async function recover() {
    if(isBusy()||reviewing)return;
    const list=state.scenes.filter(recoverable);
    if(!list.length)return;
    const ok=await askChoice(`Đưa ${list.length} cảnh lỗi nền của bản cũ về hàng đợi? Video có thể đã được Muse tạo nhưng chưa lưu được. Chạy lại có thể tốn thêm lượt. Hãy kiểm tra/tải video còn trên Muse trước. Thao tác này chưa tự bắt đầu chạy.`,[{value:true,label:'Đưa về hàng đợi',primary:true},{value:false,label:'Hủy'}]);
    if(!ok)return;
    for(const sc of list){sc.lastError=sc.reason;sc.status='pending';sc.reason='Khôi phục lỗi nền cũ — chờ người dùng chạy lại';sc.retryable=true;sc.autoRetries=0;}
    await save();render();
  }
  function update(){
    const count=state.scenes.filter(sc=>sc.frameCheck?.ok===null).length;
    node('deferredFrameCount').textContent=count?`${count} video đã lưu, chưa xác minh hình`:'';
    node('reviewFramesBtn').disabled=isBusy()||reviewing;
    node('recoverBackgroundBtn').disabled=isBusy()||reviewing||!state.scenes.some(recoverable);
  }
  const hook=globalThis.museAfterRender;
  globalThis.museAfterRender=()=>{hook?.();update();if(!reviewing&&!document.hidden&&!isBusy()&&state.scenes.some(sc=>sc.frameCheck?.code==='deferred'))queueMicrotask(()=>review());};
  node('reviewFramesBtn').addEventListener('click',()=>review(true));
  node('recoverBackgroundBtn').addEventListener('click',recover);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)review();});
  update();
  // Initial async init may load state after this script. The manual button remains available.
})();
