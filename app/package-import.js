/* One folder import; shared character images are stored once per project. */
(() => {
  const node = id => document.getElementById(id);
  let importing = false;
  async function storeCharacter(file, metadata) {
    const key = `${state.pid}:library:${metadata.id}`;
    await idb.put(key, file);
    return {id:metadata.id,name:metadata.name,aliases:metadata.aliases||[],key,fileName:file.name};
  }
  async function importLibrary(files) {
    if (isBusy() || importing) return;
    importing = true; globalThis.museImportBusy = true;
    try {
      const candidates = [...(state.characterLibrary || [])];
      const pending = [];
      for (const file of files) {
        if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw Error('Chỉ nhận ảnh PNG/JPG/WebP.');
        const name = file.name.replace(/\.[^.]+$/, '').replace(/^character[_-]/i,'').trim();
        if (!name || MuseReferenceModel.parseName(file.name)) throw Error('Ảnh thư viện cần tên Mia.png hoặc character_Mia.png, không phải c01_…');
        const existing = candidates.find(c=>c.name.toLowerCase()===name.toLowerCase());
        const id = existing?.id || name.toLowerCase();
        const metadata = {id,name,aliases:existing?.aliases||[],image:file.name};
        const i = candidates.findIndex(c=>c.id===id);
        if(i>=0)candidates[i]={...candidates[i],...metadata}; else candidates.push(metadata);
        pending.push({file,metadata});
      }
      // Reuse package validation to reject ambiguous names before saving.
      MuseReferenceModel.validatePackage({schemaVersion:1,promptsFile:'prompts.txt',characters:candidates.map(c=>({...c,image:c.image||c.fileName})),scenes:[]},0);
      const next=[...(state.characterLibrary||[])];
      for(const {file,metadata} of pending){const c=await storeCharacter(file,metadata);const i=next.findIndex(x=>x.id===c.id);if(i>=0)next[i]=c;else next.push(c);}
      state.characterLibrary=next;
      await save(); render();
      log(`Thư viện: ${pending.length} ảnh đã nạp; tự nhận diện tên trong prompt khi không có ánh xạ cảnh.`);
    } catch(e){showBanner('warn',e.message);} finally {importing=false;globalThis.museImportBusy=false;render();}
  }
  async function importPackage(files) {
    if(isBusy()||importing)return;
    importing=true; globalThis.museImportBusy=true;
    const originPid=state.pid;
    try {
      const entries=[...files].map(file=>({file,path:(file.webkitRelativePath||file.relativePath||file.name).replace(/\\/g,'/')}));
      const manifests=entries.filter(e=>/(^|\/)muse_package\.json$/i.test(e.path));
      if(manifests.length!==1)throw Error('Thư mục phải chứa đúng một muse_package.json.');
      const manifest=manifests[0];const base=manifest.path.slice(0,-'muse_package.json'.length);
      const lookup=relative=>{
        MuseReferenceModel.safePath(relative);
        const found=entries.filter(e=>e.path===base+relative);
        if(found.length!==1)throw Error(`Thiếu hoặc trùng file: ${relative}`);
        return found[0].file;
      };
      const pkg=JSON.parse(await manifest.file.text());
      const promptFile=lookup(pkg.promptsFile);
      const raw=await promptFile.text();
      const parsed=parsePrompts(raw);
      MuseReferenceModel.validatePackage(pkg,parsed.prompts.length);
      const chars=pkg.characters.map(c=>({c,file:lookup(c.image)}));
      const boards=pkg.scenes.filter(sc=>sc.storyboard).map(sc=>({sc,file:lookup(sc.storyboard)}));
      if(state.pid!==originPid||isBusy())throw Error('Dự án đã thay đổi hoặc đang chạy; hãy nhập lại gói.');
      if(!await loadPromptsText(raw,promptFile.name))return;
      if(state.pid!==originPid||isBusy())throw Error('Dự án đã thay đổi trong khi nhập.');
      state.packageImportError='Gói tham chiếu chưa nhập xong. Hãy nhập lại đủ thư mục trước khi chạy.';
      await save();
      state.imageKeys=[];state.scenes.forEach(sc=>{sc.image=false;});
      for(const sc of pkg.scenes)sceneBy(sc.n).characterIds=[...sc.characters];
      state.characterLibrary=[];
      for(const {c,file} of chars)state.characterLibrary.push(await storeCharacter(file,c));
      for(const {sc,file} of boards)await storeSceneReference(sceneBy(sc.n),file,'storyboard',`c${pad(sc.n)}`);
      state.packageImportError=null;
      if(pkg.title)state.episode=String(pkg.title);
      // The user selected a reference package: enable its attachment mode.
      state.settings.attachImages=true;
      await save(); syncInputs(); updateInfo();render();
      log(`Đã nhập gói: ${pkg.scenes.length} cảnh, ${chars.length} nhân vật, ${boards.length} storyboard. Ánh xạ từ gói được ưu tiên.`);
    } catch(e){await save();showBanner('warn',`Không nhập xong gói: ${e.message}. Không chạy nếu chưa đủ ảnh.`);} finally {importing=false;globalThis.museImportBusy=false;render();}
  }
  node('packageFolder').addEventListener('change',async e=>{await importPackage(e.target.files);e.target.value='';});
  node('characterLibraryFiles').addEventListener('change',async e=>{await importLibrary(e.target.files);e.target.value='';});
  const hook=globalThis.museAfterRender;
  globalThis.museAfterRender=()=>{
    hook?.();
    node('packageFolder').disabled=node('characterLibraryFiles').disabled=isBusy()||importing;
    node('libraryInfo').textContent=(state.characterLibrary||[]).map(c=>c.name).join(' · ')||'Chưa có ảnh nhân vật. Đặt tên file Mia.png, Dad.png…';
  };
  globalThis.museAfterRender();
  globalThis.museImportPackage=importPackage;
})();
