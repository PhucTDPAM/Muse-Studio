/* Data-only helpers, shared by the engine and dashboard. */
(() => {
  function parseName(name) {
    const match = /^c0*(\d+)_(character|storyboard)(?:_([^/\\]+))?\.(png|jpe?g|webp)$/i.exec(name);
    if (!match || +match[1] < 1) return null;
    return { n: +match[1], role: match[2].toLowerCase(), label: match[3] || (match[2].toLowerCase() === 'character' ? 'Character' : 'Storyboard') };
  }
  function shouldRetry(scene, settings) {
    const max = Math.max(1, Math.min(5, Math.round(+settings.autoRetryMax || 2)));
    return !!settings.autoRetry && scene.status === 'error' && scene.retryable !== false &&
      (scene.autoRetries || 0) < max && (scene.errorKind !== 'refused' || !!settings.autoRetryRefused);
  }
  function instructions(refs) {
    if (!refs.length) return '';
    const items = refs.map((r, i) => `Image ${i + 1}: ${r.role === 'character' ? 'IDENTITY ONLY reference (never a starting frame)' : 'single-shot full-frame composition reference'} for ${r.label}.`).join(' ');
    return `Attached images in upload order: ${items} Use the character images only to preserve identity, never show their reference backgrounds, reference-sheet layouts or poses as an intro. Render a finished full-bleed 16:9 scene from the very first frame through the final frame. The first frame must already match the shot camera and scene layout. One continuous shot with stable framing matching the requested camera direction: no reference-image flash, white borders, contact sheets, split screen, collage, opening still, introductory slide, transitions or sudden reframing. Preserve identity and clothing of only the characters named in this shot. `;
  }

  function detectCharacters(prompt, library) {
    // Quoted speech may name somebody who is not on screen.
    const visual = String(prompt).replace(/"[^"]*"|“[^”]*”/g, ' ');
    const tokens = text => String(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean).join(' ');
    const haystack = ` ${tokens(visual)} `;
    return library.filter(c => [c.name, ...(c.aliases || [])].some(name => {
      const needle = tokens(name);
      return needle && haystack.includes(` ${needle} `);
    })).map(c => c.id);
  }

  function resolve(scene, library = []) {
    const ids = Array.isArray(scene.characterIds) ? scene.characterIds : detectCharacters(scene.prompt, library);
    const refs = [];
    for (const id of [...new Set(ids)]) {
      const c = library.find(c => c.id === id);
      if (!c) throw new Error(`Chưa có ảnh nhân vật ${id}. Hãy nạp thư viện hoặc sửa ánh xạ cảnh.`);
      refs.push({key:c.key, name:c.fileName, label:c.name, role:'character', source:'library'});
    }
    // A manually assigned character image with the same label overrides the library.
    for (const ref of scene.references || []) {
      const i = refs.findIndex(r => r.role === ref.role && r.label.toLowerCase() === ref.label.toLowerCase());
      if (i >= 0) refs[i] = ref; else refs.push(ref);
    }
    return [...new Map(refs.map(r=>[r.key,r])).values()];
  }
  function safePath(value) {
    if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.includes(':') || value.split('/').some(x=>!x || x==='.' || x==='..')) throw new Error('Invalid package path');
    return value;
  }
  function validatePackage(pkg, count) {
    if (!pkg || pkg.schemaVersion !== 1 || !Array.isArray(pkg.characters) || !Array.isArray(pkg.scenes)) throw new Error('Gói không đúng schemaVersion 1.');
    safePath(pkg.promptsFile);
    const ids = new Set(), names = new Set();
    for (const c of pkg.characters) {
      if (typeof c.id !== 'string' || !c.id.trim() || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.aliases || [])) throw new Error('Nhân vật thiếu tên/ID hoặc trùng ID.');
      ids.add(c.id); safePath(c.image);
      if (!/\.(png|jpe?g|webp)$/i.test(c.image)) throw new Error('Ảnh nhân vật phải là PNG/JPG/WebP.');
      const local = new Set();
      for(const name of [c.name,...(c.aliases||[])]) {
        if(typeof name!=='string'||!name.trim())throw new Error('Bí danh không hợp lệ.');
        const key=name.trim().toLowerCase();
        if(local.has(key))continue;
        if(names.has(key))throw new Error('Tên/bí danh nhân vật bị trùng: '+name);
        names.add(key);local.add(key);
      }
    }
    const numbers=new Set();
    for(const sc of pkg.scenes) {
      if(!Number.isInteger(sc.n)||sc.n<1||sc.n>count||numbers.has(sc.n)||!Array.isArray(sc.characters)||sc.characters.some(id=>!ids.has(id)))throw new Error('Ánh xạ cảnh không hợp lệ.');
      numbers.add(sc.n);
      if(sc.storyboard){safePath(sc.storyboard);if(!/\.(png|jpe?g|webp)$/i.test(sc.storyboard))throw new Error('Storyboard phải là ảnh.');}
    }
    if(numbers.size!==count)throw new Error('Số cảnh ánh xạ không khớp số dòng prompt.');
    return pkg;
  }

  globalThis.MuseReferenceModel = Object.freeze({ parseName, shouldRetry, instructions, detectCharacters, resolve, safePath, validatePackage });
})();
