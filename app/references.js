/* Scene reference attachments; all media is kept in the existing local IDB. */
(() => {
  const node = id => document.getElementById(id);
  let shown = '';
  function renderReferences() {
    const sc = selScene();
    let refs = [];
    try { refs = sc ? MuseReferenceModel.resolve(sc, state.characterLibrary || []) : []; }
    catch(e) { node('dReferences').textContent=e.message; return; }
    const signature = JSON.stringify([state.pid, sc?.n, refs, isBusy()]);
    node('quickRetry').checked = !!state.settings.autoRetry;
    node('quickRetryMax').value = state.settings.autoRetryMax || 2;
    node('dCharacters').disabled = node('dStoryboard').disabled = !sc || isBusy();
    if (signature === shown) return;
    shown = signature;
    node('dReferences').replaceChildren();
    for (const ref of refs) {
      const row = document.createElement('div');
      row.className = 'reference-row';
      const text = document.createElement('span');
      text.textContent = `${ref.role === 'character' ? 'Nhân vật' : 'Storyboard'} · ${ref.label} · ${ref.name}`;
      const remove = document.createElement('button');
      remove.textContent = ref.source === 'library' ? 'Tự gán' : 'Bỏ gán';
      remove.disabled = isBusy() || ref.source === 'library';
      remove.addEventListener('click', async () => {
        if (isBusy()) return;
        sc.references = sc.references.filter(r => r.key !== ref.key);
        // Keep blob until project cleanup; removing association is reversible by re-import.
        await save();
        renderReferences();
      });
      row.append(text, remove);
      node('dReferences').append(row);
    }
    if (!refs.length) node('dReferences').textContent = 'Chưa gán ảnh riêng cho cảnh này.';
  }
  async function addFiles(input, role) {
    const sc = selScene();
    if (!sc || isBusy()) return;
    try {
      const files = [...input.files];
      for (const file of files) {
        if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('Chỉ nhận PNG, JPG hoặc WebP.');
        await storeSceneReference(sc, file, role, file.name.replace(/\.[^.]+$/, ''));
      }
      await save();
      renderReferences();
      log(`c${pad(sc.n)}: đã gán ${files.length} ảnh ${role}.`);
    } catch (e) { showBanner('warn', `Không lưu được ảnh tham chiếu: ${e.message}`); }
    finally { input.value = ''; }
  }
  node('dCharacters').addEventListener('change', e => addFiles(e.target, 'character'));
  node('dStoryboard').addEventListener('change', e => addFiles(e.target, 'storyboard'));
  node('quickRetry').addEventListener('change', e => act('setSettings', {autoRetry:e.target.checked}));
  node('quickRetryMax').addEventListener('change', e => act('setSettings', {autoRetryMax:+e.target.value}));
  const hook = globalThis.museAfterRender;
  globalThis.museAfterRender = () => { hook?.(); renderReferences(); };
  node('scenes').addEventListener('click', renderReferences);
  node('scenes').addEventListener('keydown', renderReferences);
  renderReferences();
})();
