(() => {
  'use strict';

  const DEFAULT_PROJECT_ID = '743160343';
  const projectElement = document.getElementById('project');
  // 設定画面下部の状態表示（ログ）は削除済み。各処理からの書き込みが失敗しないよう、画面に出ない要素で受け止める
  const statusElement = document.getElementById('status') || document.createElement('p');
  const loadingStatusElement = document.getElementById('loading-status');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsToggle = document.getElementById('settings-toggle');
  const infoPanel = document.getElementById('info-panel');
  const infoToggle = document.getElementById('info-toggle');
  const wallpaperSelect = document.getElementById('wallpaper-select');
  const wallpaperFileInput = document.getElementById('wallpaper-file');
  const clearWallpaperButton = document.getElementById('clear-wallpaper');
  const customWallpaperRow = document.getElementById('custom-wallpaper-row');
  const placeholder = document.getElementById('placeholder');
  const urlInput = document.getElementById('project-url');
  const ratingSection = document.getElementById('rating-section');
  const scratchProjectLink = document.getElementById('scratch-project-link');
  const projectInfoSection = document.getElementById('project-info-section');
  const projectInfoStatus = document.getElementById('project-info-status');
  const projectInstructions = document.getElementById('project-instructions');
  const projectCredits = document.getElementById('project-credits');
  const loadButton = document.getElementById('load-button');
  const sb3FileInput = document.getElementById('sb3-file');
  const gameTitleInput = document.getElementById('game-title');
  const gameDescriptionInput = document.getElementById('game-description');
  const exportHtmlButton = document.getElementById('export-html');
  const previewSb3Button = document.getElementById('preview-sb3');
  const qrUrlOutput = document.getElementById('qr-url-output');
  const qrOutput = document.getElementById('qr-output');
  const downloadQrButton = document.getElementById('download-qr');
  let selectedSb3File = null;
  let generatedQrCanvas = null;

  let scaffolding = null;
  let loadedProjectId = null;
  let hasLoadedProject = false;
  let loadSequence = 0;
  const heldKeys = new Set();

  function setStatus(message, showPlaceholder = true) {
    if (statusElement) statusElement.textContent = message;
    if (loadingStatusElement) loadingStatusElement.textContent = message;
    if (placeholder && showPlaceholder) placeholder.hidden = false;
  }

  function openSettings() {
    infoPanel.hidden = true;
    infoToggle.setAttribute('aria-expanded', 'false');
    settingsPanel.hidden = false;
    settingsToggle.setAttribute('aria-expanded', 'true');
  }

  function closeSettings() {
    settingsPanel.hidden = true;
    settingsToggle.setAttribute('aria-expanded', 'false');
  }

  function openInfo() {
    closeSettings();
    infoPanel.hidden = false;
    infoToggle.setAttribute('aria-expanded', 'true');
  }

  function closeInfo() {
    infoPanel.hidden = true;
    infoToggle.setAttribute('aria-expanded', 'false');
  }

  const WALLPAPER_DB_NAME = 'scratch-game-player';
  const WALLPAPER_STORE_NAME = 'settings';
  let customSkinObjectUrl = null;

  function openWallpaperDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(WALLPAPER_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(WALLPAPER_STORE_NAME)) {
          request.result.createObjectStore(WALLPAPER_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveCustomSkin(blob) {
    const db = await openWallpaperDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(WALLPAPER_STORE_NAME, 'readwrite');
      transaction.objectStore(WALLPAPER_STORE_NAME).put(blob, 'custom-skin');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();
  }

  async function readCustomSkin() {
    const db = await openWallpaperDb();
    const blob = await new Promise((resolve, reject) => {
      const request = db.transaction(WALLPAPER_STORE_NAME, 'readonly')
        .objectStore(WALLPAPER_STORE_NAME).get('custom-skin');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return blob;
  }

  async function deleteCustomSkin() {
    const db = await openWallpaperDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(WALLPAPER_STORE_NAME, 'readwrite');
      transaction.objectStore(WALLPAPER_STORE_NAME).delete('custom-skin');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  }

  function setCustomSkin(blob) {
    if (customSkinObjectUrl) URL.revokeObjectURL(customSkinObjectUrl);
    customSkinObjectUrl = blob ? URL.createObjectURL(blob) : null;
  }

  function applyWallpaper(name) {
    const aliases = { default: 'classic', gradient: 'classic', grid: 'classic', gameboy: 'white' };
    const normalized = aliases[name] || name;
    const allowed = ['classic', 'white', 'red', 'custom'];
    const selected = allowed.includes(normalized) ? normalized : 'classic';
    const playerLayout = document.querySelector('.player-layout');
    document.body.dataset.wallpaper = selected;
    wallpaperSelect.value = selected;
    customWallpaperRow.hidden = selected !== 'custom';
    if (selected === 'custom' && customSkinObjectUrl) {
      playerLayout.style.setProperty(
        '--player-skin-image', `linear-gradient(#10141b33, #10141b33), url("${customSkinObjectUrl}")`
      );
    } else {
      playerLayout.style.removeProperty('--player-skin-image');
    }
    try { localStorage.setItem('sgp-wallpaper', selected); }
    catch (error) { console.warn('Wallpaper setting could not be saved:', error); }
  }

  async function restoreWallpaper() {
    try {
      const saved = localStorage.getItem('sgp-wallpaper') || 'classic';
      if (saved === 'custom') {
        const blob = await readCustomSkin();
        if (blob) setCustomSkin(blob);
        else applyWallpaper('classic');
      }
      applyWallpaper(saved === 'custom' ? (customSkinObjectUrl ? 'custom' : 'classic') : saved);
    } catch (error) {
      console.warn('Saved player appearance could not be restored:', error);
      applyWallpaper('classic');
    }
  }

  function extractProjectId(value) {
    const input = value.trim();
    if (/^\d+$/.test(input)) return input;

    let url;
    try { url = new URL(input); }
    catch { throw new Error('Scratchの共有URLまたは数字のプロジェクトIDを入力してください。'); }

    if (!/(^|\.)scratch\.mit\.edu$/i.test(url.hostname)) {
      throw new Error('Scratchの共有URLを入力してください。');
    }

    const match = url.pathname.match(/\/projects\/(\d+)/);
    if (!match) throw new Error('URLからプロジェクトIDを取得できませんでした。');
    return match[1];
  }

  function displayProjectInfo(projectInfo, projectId, expectedLoadSequence) {
    if (expectedLoadSequence !== loadSequence || loadedProjectId !== projectId) return;

    projectInfoSection.hidden = false;
    const instructions = typeof projectInfo.instructions === 'string' ? projectInfo.instructions.trim() : '';
    const credits = typeof projectInfo.description === 'string' ? projectInfo.description.trim() : '';

    projectInstructions.textContent = instructions || 'この作品には「操作方法」の記載がありません。';
    projectInstructions.classList.toggle('is-empty', !instructions);
    projectCredits.textContent = credits || 'この作品には「メモとクレジット」の記載がありません。';
    projectCredits.classList.toggle('is-empty', !credits);
    // 「Scratchの作品情報から取得しました」の表示は削除済み（要素があれば何も書かない）
  }

  async function fetchProjectData(projectId) {
    const metadataResponse = await fetch(`https://trampoline.turbowarp.org/api/projects/${projectId}`);
    if (!metadataResponse.ok) {
      throw new Error(`プロジェクト情報を取得できませんでした（HTTP ${metadataResponse.status}）。公開済みか確認してください。`);
    }

    const metadata = await metadataResponse.json();
    if (!metadata.project_token) throw new Error('プロジェクトの読み込みトークンを取得できませんでした。');

    const projectResponse = await fetch(
      `https://projects.scratch.mit.edu/${projectId}?token=${encodeURIComponent(metadata.project_token)}`
    );
    if (!projectResponse.ok) {
      throw new Error(`ゲームデータを取得できませんでした（HTTP ${projectResponse.status}）。`);
    }
    return {
      data: await projectResponse.arrayBuffer(),
      metadata
    };
  }

  function clearProjectMonitors() {
    if (!scaffolding) return;

    // Scaffolding 3.14.0 のプロジェクト切り替え時に残る旧モニターを明示的に削除する。
    // 内部プロパティを利用しているため、index.html のScaffoldingバージョン固定を維持すること。
    if (scaffolding._monitors instanceof Map) {
      for (const monitor of scaffolding._monitors.values()) {
        monitor.root?.remove();
      }
      scaffolding._monitors.clear();
    }
    scaffolding._monitorOverlay?.replaceChildren();
  }

  function createPlayer() {
    if (!window.Scaffolding) {
      throw new Error('ゲーム実行エンジンを読み込めませんでした。ページを再読み込みしてください。');
    }

    scaffolding = new window.Scaffolding.Scaffolding();
    scaffolding.width = 480;
    scaffolding.height = 360;
    scaffolding.resizeMode = 'preserve-ratio';
    scaffolding.setup();

    const storage = scaffolding.storage;
    storage.addWebStore(
      [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
      asset => `https://assets.scratch.mit.edu/internalapi/asset/${asset.assetId}.${asset.dataFormat}/get/`
    );

    scaffolding.appendTo(projectElement);
  }

  // ゲームの読み込みに失敗した時だけ、リンク入力欄の下に理由を表示する（message を空にすると消える）
  const loadErrorElement = document.getElementById('load-error');
  function showLoadError(message) {
    if (!loadErrorElement) return;
    loadErrorElement.textContent = message;
    loadErrorElement.hidden = !message;
  }

  async function loadProject(value) {
    const thisLoad = ++loadSequence;
    let projectId;

    try {
      showLoadError('');
      projectId = extractProjectId(value);
      loadButton.disabled = true;
      setStatus('ゲームデータを取得しています…');

      // 新しいゲームのデータ取得が成功するまでは、現在のゲームを止めない。
      const project = await fetchProjectData(projectId);
      if (thisLoad !== loadSequence) return false;

      setStatus('ゲームを準備しています…');
      if (!scaffolding) createPlayer();
      else {
        releaseAllKeys();
        scaffolding.stopAll();
      }

      clearProjectMonitors();
      await scaffolding.loadProject(project.data);
      if (thisLoad !== loadSequence) return false;

      scaffolding.start();
      loadedProjectId = projectId;
      hasLoadedProject = true;
      scratchProjectLink.href = `https://scratch.mit.edu/projects/${projectId}/`;
      ratingSection.hidden = false;
      // ゲーム読み込み時に取得済みのScratch作品メタデータを再利用する。
      // api.scratch.mit.eduへのブラウザー直アクセスはCORSで拒否されるため、追加fetchしない。
      displayProjectInfo(project.metadata, projectId, thisLoad);
      placeholder.hidden = true;
      setStatus(`読み込み完了：${projectId}`, false);

      // 読み込み・VMへのロード・開始がすべて成功した場合だけ設定画面を閉じる。
      closeSettings();
      return true;
    } catch (error) {
      if (thisLoad === loadSequence) {
        setStatus(error.message || '読み込みに失敗しました。');
        showLoadError(error.message || '読み込みに失敗しました。');
        openSettings();
        console.error(error);
      }
      return false;
    } finally {
      if (thisLoad === loadSequence) loadButton.disabled = false;
    }
  }

  function safeJson(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  }

  async function createStandaloneHtml(file, title, description) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    const base64 = btoa(binary);
    // CSSを読み込む。file:// で開いた場合は fetch が失敗するため、
    // 先にページへ適用済みのCSSStyleSheetからCSSルールを取得する。
    let css = '';
    const styleSheet = Array.from(document.styleSheets).find(sheet => {
      try {
        return sheet.href && new URL(sheet.href, document.baseURI).pathname.endsWith('/css/style.css');
      } catch (_) {
        return false;
      }
    });

    if (styleSheet) {
      try {
        css = Array.from(styleSheet.cssRules).map(rule => rule.cssText).join('\n');
      } catch (error) {
        console.warn('CSSOMからCSSを取得できませんでした。fetchを試します。', error);
      }
    }

    if (!css) {
      try {
        const cssUrl = new URL('css/style.css', document.baseURI);
        const cssResponse = await fetch(cssUrl.href);
        if (!cssResponse.ok) throw new Error(`HTTP ${cssResponse.status}`);
        css = await cssResponse.text();
      } catch (error) {
        throw new Error('プレイヤーCSSを取得できませんでした。index.htmlを直接開いている場合は、READMEの手順でローカルHTTPサーバーを起動してください。詳細: ' + (error.message || error));
      }
    }

    // ZIP内のD-pad SVG素材を、書き出しHTMLではdata URIにして単体動作を維持する。
    const dpadStates = ['neutral', 'up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'];
    await Promise.all(dpadStates.map(async state => {
      const assetName = `state-${state}.svg`;
      const assetUrl = new URL(`assets/dpad/${assetName}`, document.baseURI);
      const response = await fetch(assetUrl.href);
      if (!response.ok) throw new Error(`D-pad素材を読み込めません: ${assetName}`);
      const svg = await response.text();
      const dataUrl = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      const escapedName = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      css = css.replace(new RegExp(`url\\([\\"']?(?:[^)]*\\/)?${escapedName}[\\"']?\\)`, 'g'), `url("${dataUrl}")`);
    }));
    css = css.replace(/<\/style/gi, '<\\/style');
    const titleLiteral = safeJson(title || 'Scratch Game');
    const descriptionLiteral = safeJson(description || '');

    // 出力HTMLはSB3を内包し、実行時に元のプレイヤー本体を必要としない。
    return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#111318"><meta name="description" content=${safeJson(description || title || 'Scratch game')}>
<title>${title.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}</title>
<style>${css}</style>
<script src="https://cdn.jsdelivr.net/npm/@turbowarp/packager@3.14.0/dist/scaffolding/scaffolding-min.js"><\/script>
</head><body data-wallpaper="classic">
<main class="player-layout">
<section class="controls dpad state-neutral" aria-label="方向キー">
<button class="control up" data-key="ArrowUp" aria-label="上"></button><button class="control left" data-key="ArrowLeft" aria-label="左"></button><button class="control right" data-key="ArrowRight" aria-label="右"></button><button class="control down" data-key="ArrowDown" aria-label="下"></button></section>
<section class="game-area" aria-label="ゲーム画面"><div id="project" class="project"><div id="placeholder" class="placeholder"><div class="loader"></div><p id="loading-status">ゲームを準備しています…</p></div></div></section>
<section class="controls action-buttons" aria-label="アクションボタン">
<button class="control button-y" data-key="y" aria-label="Y">Y</button><button class="control button-x" data-key="x" aria-label="X">X</button><button class="control button-b" data-key="b" aria-label="B">B</button><button class="control button-a" data-key="a" aria-label="A">A</button></section>
<div class="system-buttons" aria-label="ゲーム操作"><button id="green-flag" class="system-button start-button" type="button">START</button><button id="stop-button" class="system-button stop-button" type="button">STOP</button></div></main>
<script>
(() => {
'use strict';
const PROJECT_B64 = ${safeJson(base64)};
const GAME_TITLE = ${titleLiteral};
const projectElement = document.getElementById('project');
const placeholder = document.getElementById('placeholder');
const heldKeys = new Set();
let scaffolding = null;
function status(message) { document.getElementById('loading-status').textContent = message; placeholder.hidden = false; }
function keyboard() { return scaffolding?.vm?.runtime?.ioDevices?.keyboard || null; }
function sendKey(key, isDown) {
 const device = keyboard();
 if (!device) return;
 device.postData({key, isDown});
}
function updateDpadTilt() {
 const dpad = document.querySelector('.dpad');
 if (!dpad) return;
 const up = dpadHeldKeys.has('ArrowUp') && !dpadHeldKeys.has('ArrowDown');
 const down = dpadHeldKeys.has('ArrowDown') && !dpadHeldKeys.has('ArrowUp');
 const left = dpadHeldKeys.has('ArrowLeft') && !dpadHeldKeys.has('ArrowRight');
 const right = dpadHeldKeys.has('ArrowRight') && !dpadHeldKeys.has('ArrowLeft');
 const directions = [];
 if (up) directions.push('up');
 if (down) directions.push('down');
 if (left) directions.push('left');
 if (right) directions.push('right');
 const state = directions.length ? directions.join('-') : 'neutral';
 dpad.classList.remove(...Array.from(dpad.classList).filter(name => name.startsWith('state-')));
 dpad.classList.add('state-' + state);
}
const activeDpadPointers = new Map();
const dpadHeldKeys = new Set();
const dpadReleaseTimers = new Map();
function getDpadDirectionKeys(event) {
 const rect = dpadElement.getBoundingClientRect();
 const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
 const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
 const keys = new Set();
 // Center dead-zone prevents accidental input when a finger rests near the pivot.
 if (Math.hypot(dx, dy) < 0.10) return keys;
 // Eight-way sectors: a diagonal activates both adjacent directions.
 if (Math.abs(dx) > Math.abs(dy) * 0.42) keys.add(dx < 0 ? 'ArrowLeft' : 'ArrowRight');
 if (Math.abs(dy) > Math.abs(dx) * 0.42) keys.add(dy < 0 ? 'ArrowUp' : 'ArrowDown');
 return keys;
}
function refreshDpadInput() {
 const nextKeys = new Set();
 for (const keys of activeDpadPointers.values()) {
  for (const key of keys) nextKeys.add(key);
 }
 for (const key of dpadHeldKeys) {
  if (!nextKeys.has(key) && !dpadReleaseTimers.has(key)) {
   // Scratchはフレーム単位でキー状態を読むため、短すぎるタップを取りこぼさないよう短い保持時間を設ける。
   const timer = setTimeout(() => {
    dpadReleaseTimers.delete(key);
    const stillHeld = [...activeDpadPointers.values()].some(keys => keys.has(key));
    if (!stillHeld && dpadHeldKeys.has(key)) {
     sendKey(key, false); heldKeys.delete(key); dpadHeldKeys.delete(key); updateDpadTilt();
    }
   }, 45);
   dpadReleaseTimers.set(key, timer);
  }
 }
 for (const key of nextKeys) {
  const timer = dpadReleaseTimers.get(key);
  if (timer) { clearTimeout(timer); dpadReleaseTimers.delete(key); }
  if (!dpadHeldKeys.has(key)) {
   sendKey(key, true); heldKeys.add(key); dpadHeldKeys.add(key);
  }
 }
 updateDpadTilt();
}
const dpadElement = document.querySelector('.dpad');
updateDpadTilt();
dpadElement.addEventListener('pointerdown', event => {
 if (event.pointerType === 'mouse' && event.button !== 0) return;
 event.preventDefault();
 activeDpadPointers.set(event.pointerId, getDpadDirectionKeys(event));
 dpadElement.setPointerCapture?.(event.pointerId);
 refreshDpadInput();
});
dpadElement.addEventListener('pointermove', event => {
 if (!activeDpadPointers.has(event.pointerId)) return;
 event.preventDefault();
 activeDpadPointers.set(event.pointerId, getDpadDirectionKeys(event));
 refreshDpadInput();
});
function endDpadPointer(event) {
 if (!activeDpadPointers.delete(event.pointerId)) return;
 refreshDpadInput();
}
dpadElement.addEventListener('pointerup', endDpadPointer);
dpadElement.addEventListener('pointercancel', endDpadPointer);
dpadElement.addEventListener('lostpointercapture', endDpadPointer);
const activeActionPointers = new Map();
const actionKeyCounts = new Map();
const actionKeyDownTimes = new Map();
const actionKeyReleaseTimers = new Map();
const ACTION_MIN_PRESS_MS = 60;
const actionButtons = [...document.querySelectorAll('.action-buttons .control[data-key]')];
const actionButtonsElement = document.querySelector('.action-buttons');
function getActionButtonsAtPoint(event) {
 const candidates = actionButtons.map(button => {
  const rect = button.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return {button, key: button.dataset.key, distance: Math.hypot(event.clientX - cx, event.clientY - cy), radius: Math.min(rect.width, rect.height) * 0.78, size: Math.min(rect.width, rect.height)};
 }).sort((a, b) => a.distance - b.distance);
 if (!candidates.length) return [];
 // 2つのボタンの間を押している時は、少し外側（ボタンの大きさ×0.95以内）まで反応させる
 const isPair = Boolean(candidates[1] && candidates[1].distance <= candidates[1].size * 1.1 && candidates[1].distance <= candidates[0].distance * 2.0
  // ひし形の真ん中のように3つ以上が同じくらい近い時は同時押しにしない
  && !(candidates[2] && candidates[2].distance < candidates[1].distance * 1.15));
 if (candidates[0].distance > (isPair ? candidates[0].size * 0.95 : candidates[0].radius)) return [];
 const selected = [candidates[0]];
 // 親指が隣接ボタンの間にある場合、近接する2ボタンを同時入力にする。
 // 判定を甘くするため、2つ目のボタンは「ボタンの大きさ×1.1以内」かつ「1つ目までの距離の2.0倍以内」なら同時押しにする。
 // 数値を大きくすると同時押しになりやすく、小さくすると単押しになりやすい。
 if (isPair) selected.push(candidates[1]);
 return selected.map(item => item.button);
}
function pressActionPointer(event) {
 if (event.pointerType === 'mouse' && event.button !== 0) return;
 event.preventDefault();
 if (activeActionPointers.has(event.pointerId)) return;
 const buttons = getActionButtonsAtPoint(event);
 if (!buttons.length) return;
 actionButtonsElement.setPointerCapture?.(event.pointerId);
 const keys = buttons.map(button => button.dataset.key);
 activeActionPointers.set(event.pointerId, {keys, buttons});
 for (const button of buttons) {
  const key = button.dataset.key;
  const count = actionKeyCounts.get(key) || 0;
  actionKeyCounts.set(key, count + 1);
  if (count === 0) {
   const releaseTimer = actionKeyReleaseTimers.get(key);
   if (releaseTimer) { clearTimeout(releaseTimer); actionKeyReleaseTimers.delete(key); }
   if (!heldKeys.has(key)) {
    heldKeys.add(key);
    actionKeyDownTimes.set(key, performance.now());
    sendKey(key, true);
   }
  }
  button.classList.add('pressed');
 }
}
function releaseActionPointer(event) {
 const active = activeActionPointers.get(event.pointerId);
 if (!active) return;
 activeActionPointers.delete(event.pointerId);
 for (const button of active.buttons) {
  const key = button.dataset.key;
  const count = (actionKeyCounts.get(key) || 1) - 1;
  if (count <= 0) {
   actionKeyCounts.delete(key);
   button.classList.remove('pressed');
   const downTime = actionKeyDownTimes.get(key) ?? performance.now();
   const remaining = Math.max(0, ACTION_MIN_PRESS_MS - (performance.now() - downTime));
   const releaseTimer = setTimeout(() => {
    actionKeyReleaseTimers.delete(key);
    if ((actionKeyCounts.get(key) || 0) === 0 && heldKeys.has(key)) {
     heldKeys.delete(key);
     actionKeyDownTimes.delete(key);
     sendKey(key, false);
    }
   }, remaining);
   actionKeyReleaseTimers.set(key, releaseTimer);
  } else actionKeyCounts.set(key, count);
 }
}
actionButtonsElement.addEventListener('pointerdown', pressActionPointer);
actionButtonsElement.addEventListener('pointerup', releaseActionPointer);
actionButtonsElement.addEventListener('pointercancel', releaseActionPointer);
actionButtonsElement.addEventListener('lostpointercapture', releaseActionPointer);
actionButtonsElement.addEventListener('contextmenu', event => event.preventDefault());
// iPhone対策：ボタンを触っている間、iPhoneが長押し・スクロールの判定をしてゲームの処理を止めてしまうため、
// 十字キー・ABXYのタッチ操作を既定の動作から切り離す（入力そのものは pointer イベントで処理）
for (const element of [dpadElement, actionButtonsElement]) {
 if (!element) continue;
 element.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
 element.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
}
function releaseAll() {
 activeDpadPointers.clear();
 for (const timer of dpadReleaseTimers.values()) clearTimeout(timer);
 dpadReleaseTimers.clear();
 activeActionPointers.clear();
 actionKeyCounts.clear();
 for (const timer of actionKeyReleaseTimers.values()) clearTimeout(timer);
 actionKeyReleaseTimers.clear();
 actionKeyDownTimes.clear();
 for (const key of heldKeys) sendKey(key, false);
 heldKeys.clear();
 dpadHeldKeys.clear();
 document.querySelectorAll('.control.pressed').forEach(b => b.classList.remove('pressed'));
 updateDpadTilt();
}
document.getElementById('green-flag').addEventListener('click', () => scaffolding?.greenFlag());
document.getElementById('stop-button').addEventListener('click', () => { releaseAll(); scaffolding?.stopAll(); });
window.addEventListener('blur', releaseAll); document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });
(async () => {
 try {
  if (!window.Scaffolding) throw new Error('ゲーム実行エンジンを読み込めませんでした。');
  scaffolding = new window.Scaffolding.Scaffolding(); scaffolding.width = 480; scaffolding.height = 360; scaffolding.resizeMode = 'preserve-ratio'; scaffolding.setup();
  const storage = scaffolding.storage;
  storage.addWebStore([storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound], asset => 'https://assets.scratch.mit.edu/internalapi/asset/' + asset.assetId + '.' + asset.dataFormat + '/get/');
  scaffolding.appendTo(projectElement);
  const binary = atob(PROJECT_B64); const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await scaffolding.loadProject(bytes); scaffolding.start(); placeholder.hidden = true; document.title = GAME_TITLE;
 } catch (error) { status(error.message || 'ゲームの読み込みに失敗しました。'); console.error(error); }
})();
})();
<\/script></body></html>`;
  }

  sb3FileInput.addEventListener('change', () => {
    selectedSb3File = sb3FileInput.files?.[0] || null;
    exportHtmlButton.disabled = !selectedSb3File;
    previewSb3Button.disabled = !selectedSb3File;
    if (selectedSb3File && !gameTitleInput.value.trim()) {
      gameTitleInput.value = selectedSb3File.name.replace(/\.sb3$/i, '');
    }
    statusElement.textContent = selectedSb3File ? `選択中：${selectedSb3File.name}` : 'SB3ファイルの選択を解除しました。';
  });

  previewSb3Button.addEventListener('click', async () => {
    if (!selectedSb3File) return;
    try {
      previewSb3Button.disabled = true;
      setStatus('SB3をプレイヤーに読み込んでいます…');
      const data = await selectedSb3File.arrayBuffer();
      releaseAllKeys();
      if (!scaffolding) createPlayer();
      else scaffolding.stopAll();
      clearProjectMonitors();
      await scaffolding.loadProject(data);
      scaffolding.start();
      loadedProjectId = null;
      hasLoadedProject = true;
      ratingSection.hidden = true;
      projectInfoSection.hidden = true;
      scratchProjectLink.removeAttribute('href');
      placeholder.hidden = true;
      setStatus(`SB3プレビュー準備完了：${selectedSb3File.name}`, false);
      closeSettings();
    } catch (error) {
      setStatus(error.message || 'SB3の読み込みに失敗しました。');
      openSettings();
      console.error(error);
    } finally {
      previewSb3Button.disabled = !selectedSb3File;
    }
  });

  exportHtmlButton.addEventListener('click', async () => {
    if (!selectedSb3File) return;
    try {
      exportHtmlButton.disabled = true;
      statusElement.textContent = '専用HTMLを生成しています…';
      const html = await createStandaloneHtml(selectedSb3File, gameTitleInput.value.trim(), gameDescriptionInput.value.trim());
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const safeName = (gameTitleInput.value.trim() || 'scratch-game').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
      anchor.href = url; anchor.download = `${safeName}.html`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      statusElement.textContent = `HTMLを生成しました（SB3 ${(selectedSb3File.size / 1024 / 1024).toFixed(2)} MB）。Web公開してURLをQR化してください。`;
    } catch (error) {
      statusElement.textContent = error.message || 'HTMLの生成に失敗しました。';
      console.error(error);
    } finally {
      exportHtmlButton.disabled = !selectedSb3File;
    }
  });

  // QRCodeライブラリが初期読み込みに失敗していても、ボタン操作時に再読み込みする。
  function ensureQRCodeLibrary() {
    if (window.QRCode) return Promise.resolve(window.QRCode);

    const sources = [
      'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
      'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'
    ];

    return sources.reduce((promise, src) => promise.catch(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => window.QRCode ? resolve(window.QRCode) : reject(new Error('QRコードライブラリを確認できません。'));
      script.onerror = () => reject(new Error('QRコードライブラリを読み込めません。'));
      document.head.appendChild(script);
    })), Promise.reject(new Error('QRコードライブラリを読み込めません。')));
  }

  // QRコードの案内・エラーは、QRコードの下の文字欄に表示する
  function showQrMessage(message) {
    qrUrlOutput.textContent = message;
    qrUrlOutput.hidden = false;
  }

  document.getElementById('make-qr').addEventListener('click', async () => {
    qrOutput.replaceChildren();
    generatedQrCanvas = null;
    downloadQrButton.hidden = true;
    qrUrlOutput.hidden = true;
    qrUrlOutput.textContent = '';

    if (!loadedProjectId) {
      showQrMessage('Scratchゲームを読み込んでからQRコードを生成してください。');
      return;
    }
    if (!['http:', 'https:'].includes(window.location.protocol)) {
      showQrMessage('Web公開されたプレイヤー上でQRコードを生成してください。');
      return;
    }

    statusElement.textContent = 'QRコードを生成しています…';
    try {
      const QRCodeLibrary = await ensureQRCodeLibrary();
      const playerUrl = new URL(window.location.href);
      playerUrl.hash = '';
      playerUrl.searchParams.set('project', loadedProjectId);
      const qrUrl = playerUrl.href;

      new QRCodeLibrary(qrOutput, {
        text: qrUrl,
        width: 220,
        height: 220,
        colorDark: '#111318',
        colorLight: '#ffffff',
        correctLevel: QRCodeLibrary.CorrectLevel.H
      });

      qrUrlOutput.textContent = qrUrl;
      qrUrlOutput.hidden = false;
      window.setTimeout(() => {
        generatedQrCanvas = qrOutput.querySelector('canvas') || null;
        const generatedImage = qrOutput.querySelector('img');
        if (!generatedQrCanvas && generatedImage && generatedImage.complete) {
          const canvas = document.createElement('canvas');
          canvas.width = 220;
          canvas.height = 220;
          const context = canvas.getContext('2d');
          if (context) {
            context.drawImage(generatedImage, 0, 0, 220, 220);
            generatedQrCanvas = canvas;
          }
        }
        downloadQrButton.hidden = !generatedQrCanvas;
        if (!qrOutput.childElementCount) showQrMessage('QRコードを生成できませんでした。');
      }, 250);
    } catch (error) {
      console.error('QRコード生成エラー:', error);
      showQrMessage(`${error.message || 'QRコードの生成に失敗しました。'} ネット接続を確認してください。`);
    }
  });

  downloadQrButton.addEventListener('click', () => {
    if (!generatedQrCanvas) return;
    const anchor = document.createElement('a'); anchor.href = generatedQrCanvas.toDataURL('image/png'); anchor.download = 'game-qr.png'; anchor.click();
  });

  function keyboardDevice() {
    return scaffolding?.vm?.runtime?.ioDevices?.keyboard || null;
  }

  function sendKey(key, isDown) {
    const device = keyboardDevice();
    if (!device) return;
    device.postData({ key, isDown });
  }


  const dpadElement = document.querySelector('.dpad');
  const dpadHeldKeys = new Set();
  const activeDpadPointers = new Map();
  const dpadReleaseTimers = new Map();
  function updateDpadTilt() {
    if (!dpadElement) return;
    const up = dpadHeldKeys.has('ArrowUp') && !dpadHeldKeys.has('ArrowDown');
    const down = dpadHeldKeys.has('ArrowDown') && !dpadHeldKeys.has('ArrowUp');
    const left = dpadHeldKeys.has('ArrowLeft') && !dpadHeldKeys.has('ArrowRight');
    const right = dpadHeldKeys.has('ArrowRight') && !dpadHeldKeys.has('ArrowLeft');
    const directions = [];
    if (up) directions.push('up');
    if (down) directions.push('down');
    if (left) directions.push('left');
    if (right) directions.push('right');
    const state = directions.length ? directions.join('-') : 'neutral';
    dpadElement.classList.remove(...Array.from(dpadElement.classList).filter(name => name.startsWith('state-')));
    dpadElement.classList.add('state-' + state);
  }
  function getDpadDirectionKeys(event) {
    const rect = dpadElement.getBoundingClientRect();
    const dx = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const keys = new Set();
    if (Math.hypot(dx, dy) < 0.10) return keys;
    if (Math.abs(dx) > Math.abs(dy) * 0.42) keys.add(dx < 0 ? 'ArrowLeft' : 'ArrowRight');
    if (Math.abs(dy) > Math.abs(dx) * 0.42) keys.add(dy < 0 ? 'ArrowUp' : 'ArrowDown');
    return keys;
  }
  function refreshDpadInput() {
    const nextKeys = new Set();
    for (const keys of activeDpadPointers.values()) for (const key of keys) nextKeys.add(key);
    for (const key of dpadHeldKeys) {
      if (!nextKeys.has(key) && !dpadReleaseTimers.has(key)) {
        const timer = setTimeout(() => {
          dpadReleaseTimers.delete(key);
          const stillHeld = [...activeDpadPointers.values()].some(keys => keys.has(key));
          if (!stillHeld && dpadHeldKeys.has(key)) {
            sendKey(key, false); heldKeys.delete(key); dpadHeldKeys.delete(key); updateDpadTilt();
          }
        }, 45);
        dpadReleaseTimers.set(key, timer);
      }
    }
    for (const key of nextKeys) {
      const timer = dpadReleaseTimers.get(key);
      if (timer) { clearTimeout(timer); dpadReleaseTimers.delete(key); }
      if (!dpadHeldKeys.has(key)) {
        sendKey(key, true); heldKeys.add(key); dpadHeldKeys.add(key);
      }
    }
    updateDpadTilt();
  }
  if (dpadElement) {
    dpadElement.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      activeDpadPointers.set(event.pointerId, getDpadDirectionKeys(event));
      dpadElement.setPointerCapture?.(event.pointerId);
      refreshDpadInput();
    });
    dpadElement.addEventListener('pointermove', event => {
      if (!activeDpadPointers.has(event.pointerId)) return;
      event.preventDefault();
      activeDpadPointers.set(event.pointerId, getDpadDirectionKeys(event));
      refreshDpadInput();
    });
    const endDpadPointer = event => {
      if (!activeDpadPointers.delete(event.pointerId)) return;
      refreshDpadInput();
    };
    dpadElement.addEventListener('pointerup', endDpadPointer);
    dpadElement.addEventListener('pointercancel', endDpadPointer);
    dpadElement.addEventListener('lostpointercapture', endDpadPointer);
    dpadElement.addEventListener('contextmenu', event => event.preventDefault());
  }

  const activeActionPointers = new Map();
  const actionKeyCounts = new Map();
  const actionKeyDownTimes = new Map();
  const actionKeyReleaseTimers = new Map();
  const ACTION_MIN_PRESS_MS = 60;
  const actionButtons = [...document.querySelectorAll('.action-buttons .control[data-key]')];
  const actionButtonsElement = document.querySelector('.action-buttons');
  function getActionButtonsAtPoint(event) {
    const candidates = actionButtons.map(button => {
      const rect = button.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return { button, distance: Math.hypot(event.clientX - cx, event.clientY - cy), radius: Math.min(rect.width, rect.height) * 0.78, size: Math.min(rect.width, rect.height) };
    }).sort((a, b) => a.distance - b.distance);
    if (!candidates.length) return [];
    // 2つのボタンの間を押している時は、少し外側（ボタンの大きさ×0.95以内）まで反応させる
    const isPair = Boolean(candidates[1] && candidates[1].distance <= candidates[1].size * 1.1 && candidates[1].distance <= candidates[0].distance * 2.0
     // ひし形の真ん中のように3つ以上が同じくらい近い時は同時押しにしない
     && !(candidates[2] && candidates[2].distance < candidates[1].distance * 1.15));
    if (candidates[0].distance > (isPair ? candidates[0].size * 0.95 : candidates[0].radius)) return [];
    const selected = [candidates[0]];
    // 同時押しの判定を甘くするため、2つ目のボタンは「ボタンの大きさ×1.1以内」かつ「1つ目までの距離の2.0倍以内」なら同時押しにする。
    // 数値を大きくすると同時押しになりやすく、小さくすると単押しになりやすい（専用HTMLのテンプレート側も同じ値）
    if (isPair) selected.push(candidates[1]);
    return selected.map(item => item.button);
  }
  function pressActionPointer(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (activeActionPointers.has(event.pointerId)) return;
    const buttons = getActionButtonsAtPoint(event);
    if (!buttons.length) return;
    actionButtonsElement.setPointerCapture?.(event.pointerId);
    const keys = buttons.map(button => button.dataset.key);
    activeActionPointers.set(event.pointerId, { keys, buttons });
    for (const button of buttons) {
      const key = button.dataset.key;
      const count = actionKeyCounts.get(key) || 0;
      actionKeyCounts.set(key, count + 1);
      if (count === 0) {
        const releaseTimer = actionKeyReleaseTimers.get(key);
        if (releaseTimer) { clearTimeout(releaseTimer); actionKeyReleaseTimers.delete(key); }
        if (!heldKeys.has(key)) {
          heldKeys.add(key);
          actionKeyDownTimes.set(key, performance.now());
          sendKey(key, true);
        }
      }
      button.classList.add('pressed');
    }
  }
  function releaseActionPointer(event) {
    const active = activeActionPointers.get(event.pointerId);
    if (!active) return;
    activeActionPointers.delete(event.pointerId);
    for (const button of active.buttons) {
      const key = button.dataset.key;
      const count = (actionKeyCounts.get(key) || 1) - 1;
      if (count <= 0) {
        actionKeyCounts.delete(key);
        button.classList.remove('pressed');
        const downTime = actionKeyDownTimes.get(key) ?? performance.now();
        const remaining = Math.max(0, ACTION_MIN_PRESS_MS - (performance.now() - downTime));
        const releaseTimer = setTimeout(() => {
          actionKeyReleaseTimers.delete(key);
          if ((actionKeyCounts.get(key) || 0) === 0 && heldKeys.has(key)) {
            heldKeys.delete(key);
            actionKeyDownTimes.delete(key);
            sendKey(key, false);
          }
        }, remaining);
        actionKeyReleaseTimers.set(key, releaseTimer);
      } else actionKeyCounts.set(key, count);
    }
  }
  actionButtonsElement.addEventListener('pointerdown', pressActionPointer);
  actionButtonsElement.addEventListener('pointerup', releaseActionPointer);
  actionButtonsElement.addEventListener('pointercancel', releaseActionPointer);
  actionButtonsElement.addEventListener('lostpointercapture', releaseActionPointer);
  actionButtonsElement.addEventListener('contextmenu', event => event.preventDefault());

  // iPhone対策：ボタンを触っている間、iPhoneが長押し・スクロールの判定をしてゲームの処理を止めてしまうため、
  // 十字キー・ABXYのタッチ操作を既定の動作から切り離す（入力そのものは pointer イベントで処理）。
  // 専用HTMLのテンプレート側にも同じ処理がある
  for (const element of [dpadElement, actionButtonsElement]) {
    if (!element) continue;
    element.addEventListener('touchstart', event => event.preventDefault(), { passive: false });
    element.addEventListener('touchmove', event => event.preventDefault(), { passive: false });
  }

  function releaseAllKeys() {
    activeDpadPointers.clear();
    for (const timer of dpadReleaseTimers.values()) clearTimeout(timer);
    dpadReleaseTimers.clear();
    activeActionPointers.clear();
    actionKeyCounts.clear();
    for (const timer of actionKeyReleaseTimers.values()) clearTimeout(timer);
    actionKeyReleaseTimers.clear();
    actionKeyDownTimes.clear();
    for (const key of heldKeys) sendKey(key, false);
    heldKeys.clear();
    dpadHeldKeys.clear();
    document.querySelectorAll('.control.pressed').forEach(button => button.classList.remove('pressed'));
    updateDpadTilt();
  }

  document.getElementById('load-form').addEventListener('submit', event => {
    event.preventDefault();
    loadProject(urlInput.value);
  });

  settingsToggle.addEventListener('click', () => {
    if (settingsPanel.hidden) openSettings();
    else closeSettings();
  });
  infoToggle.addEventListener('click', () => {
    if (infoPanel.hidden) openInfo();
    else closeInfo();
  });

  document.getElementById('settings-close').addEventListener('click', closeSettings);
  document.getElementById('info-close').addEventListener('click', closeInfo);

  document.addEventListener('pointerdown', event => {
    if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && !settingsToggle.contains(event.target)) closeSettings();
    if (!infoPanel.hidden && !infoPanel.contains(event.target) && !infoToggle.contains(event.target)) closeInfo();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeSettings();
      closeInfo();
    }
  });
  wallpaperSelect.addEventListener('change', async () => {
    const selected = wallpaperSelect.value;
    if (selected === 'custom') {
      customWallpaperRow.hidden = false;
      if (customSkinObjectUrl) applyWallpaper('custom');
      else statusElement.textContent = 'プレイヤーに使う画像ファイルを選択してください。';
      return;
    }
    applyWallpaper(selected);
    statusElement.textContent = 'プレイヤーの外観を変更しました。';
  });

  wallpaperFileInput.addEventListener('change', async () => {
    const file = wallpaperFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      statusElement.textContent = '画像ファイルを選択してください。';
      wallpaperFileInput.value = '';
      return;
    }
    try {
      await saveCustomSkin(file);
      setCustomSkin(file);
      applyWallpaper('custom');
      statusElement.textContent = `プレイヤー画像を設定しました：${file.name}`;
    } catch (error) {
      statusElement.textContent = '画像を保存できませんでした。別の画像を選択してください。';
      console.error(error);
    }
  });

  clearWallpaperButton.addEventListener('click', async () => {
    try {
      await deleteCustomSkin();
      setCustomSkin(null);
      wallpaperFileInput.value = '';
      applyWallpaper('classic');
      statusElement.textContent = 'オリジナル画像を解除しました。';
    } catch (error) {
      statusElement.textContent = '画像を解除できませんでした。';
      console.error(error);
    }
  });

  // START / STOP は設定メニューではなく、本体レイアウト上の物理ボタン風UIで操作する。
  document.getElementById('green-flag').addEventListener('click', () => {
    if (scaffolding && hasLoadedProject) scaffolding.greenFlag();
  });

  document.getElementById('stop-button').addEventListener('click', () => {
    releaseAllKeys();
    scaffolding?.stopAll();
  });

  document.getElementById('fullscreen-button').addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      console.warn('Fullscreen is unavailable:', error);
      statusElement.textContent = 'このブラウザーではフルスクリーンを利用できません。';
    }
  });

  window.addEventListener('blur', releaseAllKeys);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllKeys();
  });
  window.addEventListener('pagehide', releaseAllKeys);

  restoreWallpaper();
  // QRコード経由で開かれた場合はURLのprojectパラメータを優先する。
  // 数字の作品IDとして妥当な値だけを採用し、それ以外は従来の既定作品を読み込む。
  const startupParams = new URLSearchParams(window.location.search);
  const requestedProjectId = startupParams.get('project');
  const startupProjectId = requestedProjectId && /^\d+$/.test(requestedProjectId)
    ? requestedProjectId
    : DEFAULT_PROJECT_ID;
  loadProject(startupProjectId);
})();
