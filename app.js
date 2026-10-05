/**
 * JuCut — app.js
 * Main application logic: FFmpeg.wasm loading, audio analysis,
 * silence detection, timeline rendering, and video export.
 */

// ─── FFmpeg.wasm Helpers ──────────────────────────────────────────────────
// Safely check window.FFmpeg without throwing if CDN script is pending
const getCreateFFmpeg = () => (typeof window !== 'undefined' && window.FFmpeg) ? window.FFmpeg.createFFmpeg : null;
const getFetchFile    = () => (typeof window !== 'undefined' && window.FFmpeg) ? window.FFmpeg.fetchFile : null;

// ─── App State ─────────────────────────────────────────────────────────────
const state = {
  ffmpeg: null,
  ffmpegReady: false,
  videoFile: null,
  videoURL: null,
  videoDuration: 0,
  audioBuffer: null,       // decoded AudioBuffer
  waveformData: null,      // Float32Array (normalised RMS samples)
  silenceRegions: [],      // [{start, end}] in seconds
  activeSegments: [],      // [{start, end}] — non-silence regions to keep
  segmentsBeforeRemoval: null,
  zoom: 1,
  scrollLeft: 0,
  playheadTime: 0,
  isPlaying: false,
  exportFormat: 'mp4',
  exportQuality: 'medium',
  exportMethod: 'local', // 'local' | 'script' | 'wasm'
  exportMode: 'fast',    // 'fast' | 'reencode'
  localEngine: { online: false, path: null },
  animFrameId: null,
};

// ─── DOM refs ──────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  ffmpegLoading: $('ffmpeg-loading'),
  loadingBar:    $('loading-bar'),
  loadingText:   $('loading-text'),

  topbar:          $('topbar'),
  projectName:     $('project-name-display'),
  timecode:        $('timecode-display'),
  btnPlay:         $('btn-play-pause'),
  playIcon:        $('play-icon'),
  pauseIcon:       $('pause-icon'),
  btnSkipStart:    $('btn-skip-start'),
  btnSkipEnd:      $('btn-skip-end'),
  btnRewind:       $('btn-rewind'),
  btnForward:      $('btn-forward'),
  btnExport:       $('btn-export'),

  // Mobile elements
  mobileTogglePanel: $('mobile-toggle-panel'),
  drawerBackdrop:    $('drawer-backdrop'),
  mainLayout:        $('main-layout'),
  mobileNav:         $('mobile-nav'),
  mobileBadge:       $('mobile-badge'),

  // Engine & Local Export elements
  engineBanner:     $('engine-banner'),
  engineDot:        $('engine-dot'),
  engineTitle:      $('engine-title'),
  engineDesc:       $('engine-desc'),
  btnRefreshEngine: $('btn-refresh-engine'),
  cardMethodLocal:  $('card-method-local'),
  cardMethodScript: $('card-method-script'),
  cardMethodWasm:   $('card-method-wasm'),
  scriptOptions:    $('script-options'),
  btnDlBat:         $('btn-dl-bat'),
  btnDlPy:          $('btn-dl-py'),
  exportOptionsWrap:$('export-options-wrap'),
  pillFast:         $('pill-fast'),
  pillReencode:     $('pill-reencode'),
  exportNote:       $('export-note'),

  statusDot:       $('status-dot'),
  statusText:      $('status-text'),

  dropZone:        $('drop-zone'),
  fileInput:       $('file-input'),
  mediaInfo:       $('media-info'),
  mediaFilename:   $('media-filename'),
  mediaMeta:       $('media-meta'),
  thumbCanvas:     $('thumb-canvas'),

  sliderThreshold: $('slider-threshold'),
  valThreshold:    $('val-threshold'),
  sliderMinDur:    $('slider-min-duration'),
  valMinDur:       $('val-min-duration'),
  sliderPadding:   $('slider-padding'),
  valPadding:      $('val-padding'),
  sliderSpeed:     $('slider-speed'),
  valSpeed:        $('val-speed'),
  btnDetect:       $('btn-detect'),

  sectionStats:    $('section-stats'),
  statTotal:       $('stat-total'),
  statCuts:        $('stat-cuts'),
  statRemoved:     $('stat-removed'),
  statFinal:       $('stat-final'),
  reductionPct:    $('reduction-pct'),
  reductionFill:   $('reduction-bar-fill'),

  sectionSegments: $('section-segments'),
  segmentsBadge:   $('segments-badge'),
  segmentList:     $('segment-list'),

  previewEmpty:    $('preview-empty'),
  videoPlayer:     $('video-player'),
  previewOverlay:  $('preview-overlay'),
  processingLabel: $('processing-label'),

  rulerCanvas:        $('ruler-canvas'),
  timelineTracks:     $('timeline-tracks'),
  videoTrack:         $('video-track'),
  videoTrackCanvas:   $('video-track-canvas'),
  audioTrack:         $('audio-track'),
  waveformCanvas:     $('waveform-canvas'),
  playhead:           $('playhead'),

  zoomSlider: $('zoom-slider'),
  zoomLabel:  $('zoom-label'),
  zoomIn:     $('zoom-in'),
  zoomOut:    $('zoom-out'),

  btnRemoveSilence: $('btn-remove-silence'),
  btnUndoRemove:    $('btn-undo-remove'),

  exportModal:        $('export-modal'),
  modalClose:         $('modal-close'),
  exportDuration:     $('export-duration'),
  exportCuts:         $('export-cuts'),
  exportSaved:        $('export-saved'),
  exportProgressWrap: $('export-progress-wrap'),
  exportProgressText: $('export-progress-text'),
  exportProgressPct:  $('export-progress-pct'),
  exportProgressFill: $('export-progress-fill'),
  btnStartExport:     $('btn-start-export'),
  btnCancelExport:    $('btn-cancel-export'),

  toastContainer: $('toast-container'),
};

// ─── Utility helpers ───────────────────────────────────────────────────────
function formatTime(secs, ms = false) {
  if (!isFinite(secs) || isNaN(secs)) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const base = [
    String(h).padStart(2, '0'),
    String(m).padStart(2, '0'),
    String(s).padStart(2, '0'),
  ].join(':');
  if (ms) {
    const mil = Math.floor((secs % 1) * 1000);
    return base + '.' + String(mil).padStart(3, '0');
  }
  return base;
}

function formatDuration(secs) {
  if (secs >= 60) return (secs / 60).toFixed(1) + 'm';
  return secs.toFixed(1) + 's';
}

function showToast(msg, type = 'info') {
  const icons = {
    info:    '💡',
    success: '✅',
    error:   '❌',
    warning: '⚠️',
  };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '💡'}</span><span class="toast-msg">${msg}</span>`;
  els.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

function setStatus(text, type = 'idle') {
  els.statusText.textContent = text;
  els.statusDot.className = 'status-dot ' + type;
}

function showOverlay(text) {
  els.processingLabel.textContent = text;
  els.previewOverlay.style.display = 'flex';
}
function hideOverlay() {
  els.previewOverlay.style.display = 'none';
}

// ─── 1. FFmpeg & Splash Screen Handling ────────────────────────────────────
function dismissSplashScreen() {
  if (els.ffmpegLoading && !els.ffmpegLoading.classList.contains('fade-out')) {
    if (els.loadingBar) els.loadingBar.style.width = '100%';
    if (els.loadingText) els.loadingText.textContent = 'Pronto!';
    els.ffmpegLoading.classList.add('fade-out');
    setTimeout(() => {
      if (els.ffmpegLoading && els.ffmpegLoading.parentNode) {
        els.ffmpegLoading.remove();
      }
    }, 600);
  }
}

async function initFFmpeg() {
  const hasSAB = typeof window !== 'undefined' && (window.crossOriginIsolated || window.SharedArrayBuffer);
  const createFFmpeg = getCreateFFmpeg();

  // If SharedArrayBuffer or FFmpeg CDN isn't ready on first load, don't stall
  if (!createFFmpeg || !hasSAB) {
    console.log('[JuCut] Modo Script / Local Ativo (WebAssembly desativado no primeiro load)');
    setStatus('Pronto (Modo Script/Local)', 'idle');
    dismissSplashScreen();
    return;
  }

  try {
    const ffmpeg = createFFmpeg({
      log: false,
      corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      progress: ({ ratio }) => {
        const pct = Math.round(ratio * 100);
        if (els.loadingBar) els.loadingBar.style.width = pct + '%';
      },
    });

    if (els.loadingText) els.loadingText.textContent = 'Inicializando FFmpeg...';

    // Timeout of 5 seconds so it NEVER leaves the page hanging
    const loadPromise = ffmpeg.load();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tempo limite excedido')), 5000)
    );

    await Promise.race([loadPromise, timeoutPromise]);
    state.ffmpeg = ffmpeg;
    state.ffmpegReady = true;

    setStatus('FFmpeg pronto', 'success');
  } catch (err) {
    console.warn('[JuCut] FFmpeg WebAssembly em background indisponível:', err.message);
    setStatus('Pronto (Modo Script/Local)', 'idle');
  } finally {
    dismissSplashScreen();
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── 2. File Loading ───────────────────────────────────────────────────────
function setupDropZone() {
  const dz = els.dropZone;

  dz.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', e => {
    if (e.target.files[0]) loadVideo(e.target.files[0]);
  });

  dz.addEventListener('dragover', e => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) loadVideo(file);
    else showToast('Por favor, solte um arquivo de vídeo.', 'warning');
  });
}

async function loadVideo(file) {
  state.videoFile = file;
  if (state.videoURL) URL.revokeObjectURL(state.videoURL);
  state.videoURL = URL.createObjectURL(file);

  // Show video
  els.previewEmpty.style.display = 'none';
  els.videoPlayer.style.display  = 'block';
  els.videoPlayer.src = state.videoURL;

  await new Promise(res => {
    els.videoPlayer.onloadedmetadata = res;
  });

  state.videoDuration = els.videoPlayer.duration;
  els.projectName.textContent = file.name.replace(/\.[^.]+$/, '');

  // Thumbnail
  drawThumbnail();

  // Media info
  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  els.mediaFilename.textContent = file.name;
  els.mediaMeta.textContent = `${formatTime(state.videoDuration)} · ${sizeMB} MB`;
  els.mediaInfo.style.display = 'flex';

  // Reset state
  state.silenceRegions = [];
  state.activeSegments = [];
  state.segmentsBeforeRemoval = null;
  state.waveformData = null;

  els.btnDetect.disabled = false;
  els.btnRemoveSilence.disabled = true;
  els.btnUndoRemove.disabled = true;
  els.btnExport.disabled = true;

  // Hide stats
  els.sectionStats.style.display = 'none';
  els.sectionSegments.style.display = 'none';

  // Decode audio
  setStatus('Decodificando áudio...', 'working');
  showOverlay('Analisando áudio...');

  try {
    await decodeAudio(file);
    hideOverlay();
    setStatus('Áudio decodificado', 'success');
    drawTimeline();
    showToast('Vídeo carregado com sucesso!', 'success');
  } catch (err) {
    hideOverlay();
    setStatus('Erro na decodificação', 'error');
    showToast('Erro ao decodificar o áudio: ' + err.message, 'error');
    console.error(err);
  }
}

function drawThumbnail() {
  const canvas = els.thumbCanvas;
  const ctx = canvas.getContext('2d');
  const v = els.videoPlayer;
  v.currentTime = Math.min(2, state.videoDuration * 0.1);
  v.onseeked = () => {
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    v.onseeked = null;
  };
}

// ─── 3. Audio Decoding & Waveform ─────────────────────────────────────────
async function decodeAudio(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  audioCtx.close();

  // Build waveform (RMS per chunk)
  const rawData = state.audioBuffer.getChannelData(0);
  const samples = 4000; // visual resolution
  const blockSize = Math.floor(rawData.length / samples);
  const result = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    let sumOfSquares = 0;
    for (let j = 0; j < blockSize; j++) {
      sumOfSquares += rawData[i * blockSize + j] ** 2;
    }
    result[i] = Math.sqrt(sumOfSquares / blockSize);
  }
  state.waveformData = result;
}

// ─── 4. Silence Detection ─────────────────────────────────────────────────
function detectSilences() {
  if (!state.audioBuffer) return;

  const threshold = parseFloat(els.sliderThreshold.value);
  const minDur = parseFloat(els.sliderMinDur.value);
  const padding = parseFloat(els.sliderPadding.value);

  const linearThreshold = dbToLinear(threshold);
  const sampleRate = state.audioBuffer.sampleRate;
  const channelData = state.audioBuffer.getChannelData(0);

  // Compute short-time RMS (10ms windows)
  const windowSize = Math.floor(sampleRate * 0.01);
  const numWindows = Math.floor(channelData.length / windowSize);
  const rmsValues = new Float32Array(numWindows);

  for (let i = 0; i < numWindows; i++) {
    let sum = 0;
    const start = i * windowSize;
    for (let j = 0; j < windowSize; j++) {
      sum += channelData[start + j] ** 2;
    }
    rmsValues[i] = Math.sqrt(sum / windowSize);
  }

  // Find silence regions
  const silences = [];
  let silenceStart = null;
  const windowDuration = 0.01; // 10ms

  for (let i = 0; i < rmsValues.length; i++) {
    const isSilent = rmsValues[i] < linearThreshold;
    const t = i * windowDuration;

    if (isSilent && silenceStart === null) {
      silenceStart = t;
    } else if (!isSilent && silenceStart !== null) {
      const dur = t - silenceStart;
      if (dur >= minDur) {
        silences.push({
          start: Math.max(0, silenceStart - padding),
          end:   Math.min(state.videoDuration, t + padding),
        });
      }
      silenceStart = null;
    }
  }
  // handle silence to end
  if (silenceStart !== null) {
    const dur = state.videoDuration - silenceStart;
    if (dur >= minDur) {
      silences.push({
        start: Math.max(0, silenceStart - padding),
        end:   state.videoDuration,
      });
    }
  }

  state.silenceRegions = mergeSilences(silences);

  // Compute keep-segments
  state.activeSegments = computeActiveSegments(state.silenceRegions, state.videoDuration);

  updateStats();
  drawTimeline();
  updateSegmentList();

  els.sectionStats.style.display    = 'block';
  els.sectionSegments.style.display = 'block';
  els.btnRemoveSilence.disabled = false;
  els.btnExport.disabled = false;

  setStatus(`${state.silenceRegions.length} silêncios detectados`, 'success');
  showToast(`Detectados ${state.silenceRegions.length} silêncios — ${formatDuration(totalSilenceDuration())} a remover.`, 'success');

  // If on mobile/tablet, switch to editor tab so cuts are immediately seen on timeline
  if (window.innerWidth <= 900) {
    const editorTabBtn = document.getElementById('tab-btn-editor');
    if (editorTabBtn) editorTabBtn.click();
  }
}

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

function mergeSilences(regions) {
  if (!regions.length) return [];
  regions.sort((a, b) => a.start - b.start);
  const merged = [regions[0]];
  for (let i = 1; i < regions.length; i++) {
    const last = merged[merged.length - 1];
    if (regions[i].start <= last.end + 0.05) {
      last.end = Math.max(last.end, regions[i].end);
    } else {
      merged.push(regions[i]);
    }
  }
  return merged;
}

function computeActiveSegments(silences, duration) {
  const segs = [];
  let cursor = 0;
  for (const s of silences) {
    if (s.start > cursor + 0.01) {
      segs.push({ start: cursor, end: s.start });
    }
    cursor = s.end;
  }
  if (cursor < duration - 0.01) {
    segs.push({ start: cursor, end: duration });
  }
  return segs;
}

function totalSilenceDuration() {
  return state.silenceRegions.reduce((s, r) => s + (r.end - r.start), 0);
}

function updateStats() {
  const total = state.videoDuration;
  const removed = totalSilenceDuration();
  const final = total - removed;
  const pct = Math.round((removed / total) * 100);

  els.statTotal.textContent   = formatDuration(total);
  els.statCuts.textContent    = String(state.silenceRegions.length);
  els.statRemoved.textContent = formatDuration(removed);
  els.statFinal.textContent   = formatDuration(final);
  els.reductionPct.textContent = pct + '%';

  if (els.mobileBadge) {
    els.mobileBadge.textContent = String(state.silenceRegions.length);
    els.mobileBadge.style.display = state.silenceRegions.length > 0 ? 'inline-block' : 'none';
  }

  setTimeout(() => { els.reductionFill.style.width = pct + '%'; }, 100);
}

function updateSegmentList() {
  els.segmentsBadge.textContent = state.activeSegments.length;
  els.segmentList.innerHTML = '';
  state.activeSegments.forEach((seg, i) => {
    const dur = seg.end - seg.start;
    const item = document.createElement('div');
    item.className = 'segment-item';
    item.innerHTML = `
      <span class="segment-num">#${String(i + 1).padStart(2, '0')}</span>
      <span class="segment-time">${formatTime(seg.start)} – ${formatTime(seg.end)}</span>
      <span class="segment-dur">${formatDuration(dur)}</span>
    `;
    item.addEventListener('click', () => {
      els.videoPlayer.currentTime = seg.start;
      state.playheadTime = seg.start;
      updatePlayhead();
    });
    els.segmentList.appendChild(item);
  });
}

// ─── 5. Timeline Rendering ─────────────────────────────────────────────────
function getPx() {
  // pixels per second
  const trackW = els.timelineTracks.clientWidth || 800;
  const basePPS = trackW / (state.videoDuration || 60);
  return basePPS * state.zoom;
}

function totalWidth() {
  return Math.max(els.timelineTracks.clientWidth, getPx() * state.videoDuration);
}

function drawTimeline() {
  if (!state.videoDuration) return;
  const tw = totalWidth();

  // Resize canvases
  for (const cv of [els.waveformCanvas, els.videoTrackCanvas, els.rulerCanvas]) {
    cv.width  = tw;
    cv.height = cv === els.rulerCanvas ? 24 : (cv === els.waveformCanvas ? 72 : 64);
  }
  els.timelineTracks.style.width = tw + 'px';
  els.videoTrack.style.width     = tw + 'px';
  els.audioTrack.style.width     = tw + 'px';

  drawRuler();
  drawWaveform();
  drawVideoStrip();
}

function drawRuler() {
  const canvas = els.rulerCanvas;
  const ctx = canvas.getContext('2d');
  const tw = canvas.width;
  const pps = getPx();
  const dur = state.videoDuration;

  ctx.clearRect(0, 0, tw, 24);
  ctx.fillStyle = '#1e2333';
  ctx.fillRect(0, 0, tw, 24);

  // Choose tick interval
  const minTickPx = 60;
  const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  let tickInterval = intervals.find(i => i * pps >= minTickPx) || intervals[intervals.length - 1];

  ctx.fillStyle = '#4a5068';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textBaseline = 'middle';

  for (let t = 0; t <= dur; t += tickInterval) {
    const x = t * pps;
    const isMajor = (t % (tickInterval * 5)) < 0.001;
    ctx.fillStyle = isMajor ? '#6b7491' : '#3a4060';
    ctx.fillRect(x, isMajor ? 8 : 14, 1, isMajor ? 16 : 10);
    if (isMajor) {
      ctx.fillStyle = '#6b7491';
      ctx.fillText(formatTime(t), x + 4, 12);
    }
  }
}

function drawWaveform() {
  if (!state.waveformData) return;
  const canvas = els.waveformCanvas;
  const ctx = canvas.getContext('2d');
  const tw = canvas.width;
  const h  = canvas.height;
  const pps = getPx();

  ctx.clearRect(0, 0, tw, h);
  ctx.fillStyle = '#13161e';
  ctx.fillRect(0, 0, tw, h);

  // Draw silence regions (background)
  for (const s of state.silenceRegions) {
    const x1 = s.start * pps;
    const x2 = s.end   * pps;
    ctx.fillStyle = 'rgba(255,75,110,0.15)';
    ctx.fillRect(x1, 0, x2 - x1, h);
    ctx.strokeStyle = 'rgba(255,75,110,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, 0, x2 - x1, h);
  }

  // Draw waveform
  const samples = state.waveformData;
  const dur = state.videoDuration;
  const waveW = dur * pps;
  const maxAmp = Math.max(...samples);
  const scale = maxAmp > 0 ? 1 / maxAmp : 1;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#00d4ff');
  grad.addColorStop(0.5, '#7b61ff');
  grad.addColorStop(1, '#00d4ff');

  ctx.beginPath();
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1;

  for (let x = 0; x < waveW; x++) {
    const si = Math.floor((x / waveW) * samples.length);
    const amp = samples[si] * scale;
    const yH = amp * (h / 2) * 0.85;
    ctx.moveTo(x, h / 2 - yH);
    ctx.lineTo(x, h / 2 + yH);
  }
  ctx.stroke();

  // Overlay silence with pattern on silence regions
  for (const s of state.silenceRegions) {
    const x1 = s.start * pps;
    const x2 = s.end   * pps;
    // Hatching
    ctx.save();
    ctx.beginPath();
    ctx.rect(x1, 0, x2 - x1, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,75,110,0.25)';
    ctx.lineWidth = 1;
    for (let hx = x1 - h; hx < x2 + h; hx += 8) {
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx + h, h);
      ctx.stroke();
    }
    ctx.restore();
    // Label
    ctx.fillStyle = 'rgba(255,75,110,0.9)';
    ctx.font = 'bold 9px Inter, sans-serif';
    ctx.textBaseline = 'top';
    const lw = x2 - x1;
    if (lw > 40) ctx.fillText('SILENCE', x1 + 4, 4);
  }
}

function drawVideoStrip() {
  const canvas = els.videoTrackCanvas;
  const ctx = canvas.getContext('2d');
  const tw = canvas.width;
  const h  = canvas.height;
  const pps = getPx();

  ctx.clearRect(0, 0, tw, h);
  ctx.fillStyle = '#1a1f30';
  ctx.fillRect(0, 0, tw, h);

  // Draw active segments as colored bars
  for (const seg of state.activeSegments) {
    const x1 = seg.start * pps;
    const x2 = seg.end   * pps;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,212,255,0.20)');
    grad.addColorStop(1, 'rgba(123,97,255,0.20)');
    ctx.fillStyle = grad;
    ctx.fillRect(x1, 0, x2 - x1, h);
    ctx.strokeStyle = 'rgba(0,212,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x1, 0, x2 - x1, h);
  }

  // Silence gaps
  for (const s of state.silenceRegions) {
    const x1 = s.start * pps;
    const x2 = s.end   * pps;
    ctx.fillStyle = 'rgba(255,75,110,0.12)';
    ctx.fillRect(x1, 0, x2 - x1, h);
    // Scissor icon placeholder
    ctx.fillStyle = 'rgba(255,75,110,0.7)';
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    if (x2 - x1 > 20) ctx.fillText('✂', x1 + 4, h / 2);
  }

  // Frame grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const gridStep = Math.max(1, Math.round(30 / pps));
  for (let t = 0; t < state.videoDuration; t += gridStep) {
    const x = t * pps;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

// ─── 6. Playhead ───────────────────────────────────────────────────────────
function updatePlayhead() {
  const pps = getPx();
  const x = state.playheadTime * pps;
  els.playhead.style.transform = `translateX(${x}px)`;
  els.timecode.textContent = formatTime(state.playheadTime, true);
}

function startPlayheadAnimation() {
  if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  const tick = () => {
    if (!state.isPlaying) return;
    state.playheadTime = els.videoPlayer.currentTime;
    updatePlayhead();
    state.animFrameId = requestAnimationFrame(tick);
  };
  state.animFrameId = requestAnimationFrame(tick);
}

// ─── 7. Transport ──────────────────────────────────────────────────────────
function setupTransport() {
  els.btnPlay.addEventListener('click', togglePlay);

  els.videoPlayer.addEventListener('play', () => {
    state.isPlaying = true;
    els.playIcon.style.display  = 'none';
    els.pauseIcon.style.display = 'block';
    startPlayheadAnimation();
  });

  els.videoPlayer.addEventListener('pause', () => {
    state.isPlaying = false;
    els.playIcon.style.display  = 'block';
    els.pauseIcon.style.display = 'none';
    if (state.animFrameId) cancelAnimationFrame(state.animFrameId);
  });

  els.videoPlayer.addEventListener('timeupdate', () => {
    if (!state.isPlaying) {
      state.playheadTime = els.videoPlayer.currentTime;
      updatePlayhead();
    }
  });

  els.videoPlayer.addEventListener('ended', () => {
    state.isPlaying = false;
    els.playIcon.style.display  = 'block';
    els.pauseIcon.style.display = 'none';
  });

  els.btnSkipStart.addEventListener('click', () => seek(0));
  els.btnSkipEnd.addEventListener('click',   () => seek(state.videoDuration));
  els.btnRewind.addEventListener('click',    () => seek(Math.max(0, state.playheadTime - 5)));
  els.btnForward.addEventListener('click',   () => seek(Math.min(state.videoDuration, state.playheadTime + 5)));

  // Tap video to play/pause
  els.videoPlayer.addEventListener('click', togglePlay);

  // Click on timeline to seek
  els.timelineTracks.addEventListener('click', e => {
    const rect = els.timelineTracks.getBoundingClientRect();
    const x = e.clientX - rect.left + els.timelineTracks.scrollLeft;
    const t = x / getPx();
    seek(t);
  });

  // Mobile Touch Scrubbing & Pinch-to-Zoom on Timeline
  let pinchStartDist = 0;
  let pinchStartZoom = 1;

  els.timelineTracks.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      const rect = els.timelineTracks.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left + els.timelineTracks.scrollLeft;
      const t = x / getPx();
      seek(t);
    } else if (e.touches.length === 2) {
      pinchStartDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartZoom = state.zoom;
    }
  }, { passive: true });

  els.timelineTracks.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      e.preventDefault(); // Prevent page scroll while scrubbing
      const rect = els.timelineTracks.getBoundingClientRect();
      const x = e.touches[0].clientX - rect.left + els.timelineTracks.scrollLeft;
      const t = Math.max(0, Math.min(state.videoDuration, x / getPx()));
      seek(t);
    } else if (e.touches.length === 2 && pinchStartDist > 0) {
      e.preventDefault();
      const curDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = curDist / pinchStartDist;
      const newZoom = Math.max(0.5, Math.min(20, pinchStartZoom * ratio));
      state.zoom = newZoom;
      els.zoomSlider.value = newZoom;
      els.zoomLabel.textContent = newZoom.toFixed(1) + '×';
      drawTimeline();
      updatePlayhead();
    }
  }, { passive: false });

  els.timelineTracks.addEventListener('touchend', () => {
    pinchStartDist = 0;
  }, { passive: true });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowLeft')  seek(Math.max(0, state.playheadTime - (e.shiftKey ? 10 : 1)));
    if (e.code === 'ArrowRight') seek(Math.min(state.videoDuration, state.playheadTime + (e.shiftKey ? 10 : 1)));
    if (e.code === 'Home') seek(0);
    if (e.code === 'End')  seek(state.videoDuration);
  });
}

function togglePlay() {
  if (!state.videoFile) return;
  if (state.isPlaying) els.videoPlayer.pause();
  else els.videoPlayer.play();
}

function seek(t) {
  if (!state.videoFile) return;
  els.videoPlayer.currentTime = t;
  state.playheadTime = t;
  updatePlayhead();
}

// ─── 8. Zoom ───────────────────────────────────────────────────────────────
function setupZoom() {
  function applyZoom(z) {
    state.zoom = Math.max(0.5, Math.min(20, z));
    els.zoomSlider.value = state.zoom;
    els.zoomLabel.textContent = state.zoom.toFixed(1) + '×';
    drawTimeline();
    updatePlayhead();
  }

  els.zoomSlider.addEventListener('input', () => applyZoom(parseFloat(els.zoomSlider.value)));
  els.zoomIn.addEventListener('click',  () => applyZoom(state.zoom * 1.3));
  els.zoomOut.addEventListener('click', () => applyZoom(state.zoom / 1.3));

  // Ctrl+Wheel zoom
  els.timelineTracks.addEventListener('wheel', e => {
    if (e.ctrlKey) {
      e.preventDefault();
      applyZoom(state.zoom * (e.deltaY < 0 ? 1.15 : 0.87));
    }
  }, { passive: false });
}

// ─── 9. Silence Removal ───────────────────────────────────────────────────
function removeSilences() {
  if (!state.silenceRegions.length) {
    showToast('Nenhum silêncio detectado para remover.', 'warning');
    return;
  }

  state.segmentsBeforeRemoval = JSON.parse(JSON.stringify(state.activeSegments));
  els.btnUndoRemove.disabled = false;

  // Already computed activeSegments, just update UI
  updateStats();
  drawTimeline();
  setStatus('Silêncios marcados para remoção', 'success');
  showToast(`${state.silenceRegions.length} silêncios serão removidos na exportação.`, 'success');
}

function undoRemoveSilences() {
  if (!state.segmentsBeforeRemoval) return;
  state.activeSegments = state.segmentsBeforeRemoval;
  state.segmentsBeforeRemoval = null;
  state.silenceRegions = [];
  els.btnUndoRemove.disabled = true;
  drawTimeline();
  setStatus('Desfazendo remoção', 'idle');
  showToast('Remoção desfeita.', 'info');
}

// ─── 10. Local Engine & Export Modal ──────────────────────────────────────
async function checkLocalEngine() {
  if (els.engineDot) {
    els.engineDot.className = 'engine-dot';
    els.engineTitle.textContent = 'Verificando motor local...';
    els.engineDesc.textContent = 'Conectando ao servidor em localhost:8765...';
  }

  let online = false;
  let engineData = null;

  // Tentar na mesma origem
  try {
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      engineData = await res.json();
      online = engineData.online;
    }
  } catch (e) {}

  // Tentar explicitamente em localhost:8765
  if (!online) {
    try {
      const res = await fetch('http://localhost:8765/api/status', { signal: AbortSignal.timeout(1200) });
      if (res.ok) {
        engineData = await res.json();
        online = engineData.online;
      }
    } catch (e) {}
  }

  state.localEngine = {
    online: online,
    path: engineData ? engineData.ffmpeg_path : null
  };

  updateEngineUI(online, engineData);
  return online;
}

function updateEngineUI(online, data) {
  if (!els.engineDot) return;

  if (online) {
    els.engineDot.className = 'engine-dot online';
    els.engineTitle.textContent = '⚡ Motor Local Ativo (FFmpeg Nativo)';
    els.engineDesc.textContent = 'Pronto para exportação ultra-rápida (corte em segundos via GPU/CPU)';
    selectExportMethod('local');
  } else {
    els.engineDot.className = 'engine-dot offline';
    els.engineTitle.textContent = 'Servidor local não conectado';
    els.engineDesc.textContent = 'Execute iniciar.bat ou baixe o Script .BAT para corte instantâneo';
    selectExportMethod('script');
  }
}

function selectExportMethod(method) {
  state.exportMethod = method;

  // Toggle method cards
  document.querySelectorAll('.method-card').forEach(c => {
    c.classList.toggle('active', c.dataset.method === method);
  });

  if (method === 'script') {
    if (els.scriptOptions) els.scriptOptions.style.display = 'flex';
    if (els.exportOptionsWrap) els.exportOptionsWrap.style.display = 'none';
    if (els.btnStartExport) {
      els.btnStartExport.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Baixar Script .BAT (3s)
      `;
    }
    if (els.exportNote) els.exportNote.textContent = 'O script .BAT executa o corte no seu PC em ~3 segundos via stream copy.';
  } else {
    if (els.scriptOptions) els.scriptOptions.style.display = 'none';
    if (els.exportOptionsWrap) els.exportOptionsWrap.style.display = 'flex';
    if (els.btnStartExport) {
      const isLocal = method === 'local';
      els.btnStartExport.innerHTML = isLocal
        ? `⚡ Iniciar Exportação Nativa (Rápida)`
        : `🌐 Iniciar Exportação no Navegador`;
    }
    if (els.exportNote) {
      els.exportNote.textContent = method === 'local'
        ? 'Processando com FFmpeg Nativo no seu computador (alta velocidade).'
        : 'Processando no navegador via WebAssembly (pode demorar para vídeos grandes).';
    }
  }
}

function openExportModal() {
  const total = state.videoDuration;
  const removed = totalSilenceDuration();
  const final = total - removed;

  els.exportDuration.textContent = formatDuration(final);
  els.exportCuts.textContent     = String(state.silenceRegions.length);
  els.exportSaved.textContent    = formatDuration(removed);

  els.exportProgressWrap.style.display = 'none';
  els.exportProgressFill.style.width   = '0%';
  els.exportProgressPct.textContent    = '0%';
  els.btnStartExport.disabled          = false;
  els.btnCancelExport.textContent      = 'Cancelar';

  els.exportModal.style.display = 'flex';

  // Verificar se o servidor local está online
  checkLocalEngine();
}

function closeExportModal() {
  els.exportModal.style.display = 'none';
}

// ─── 11. Script Generators (Download .BAT / .PY) ───────────────────────────
function downloadBatchScript() {
  if (!state.videoFile || !state.activeSegments.length) {
    showToast('Nenhum corte para exportar.', 'warning');
    return;
  }
  const filename = state.videoFile.name;
  const baseName = filename.replace(/\.[^.]+$/, '');
  const ext = filename.split('.').pop() || 'mp4';
  const outName = `${baseName}_cortado.${ext}`;

  const lines = [
    '@echo off',
    'chcp 65001 > nul',
    'title JuCut — Corte Ultra-Rapido de Silencios',
    'color 0b',
    'echo ========================================================',
    'echo       JuCut — Corte Ultra-Rapido com FFmpeg Nativo',
    'echo ========================================================',
    'echo.',
    `echo  [*] Video de Entrada: "${filename}"`,
    `echo  [*] Video de Saida:   "${outName}"`,
    `echo  [*] Total de Cortes:  ${state.activeSegments.length}`,
    'echo.',
    'REM 1. Localizar executavel do FFmpeg',
    'set FFMPEG=ffmpeg',
    'if exist "ffmpeg.exe" (set FFMPEG="ffmpeg.exe")',
    '%FFMPEG% -version >nul 2>&1',
    'if %errorlevel% neq 0 (',
    '    echo [AVISO] FFmpeg nao encontrado no sistema.',
    '    echo Baixando ffmpeg.exe portatil automaticamente...',
    '    curl -L -o ffmpeg.exe "https://github.com/eugeneware/ffmpeg-static/releases/latest/download/ffmpeg-win32-x64" >nul 2>&1',
    '    set FFMPEG="ffmpeg.exe"',
    ')',
    'echo  [*] Cortando trechos com stream copy (sem perda de qualidade)...',
    'if not exist temp_jucut mkdir temp_jucut',
    'if exist temp_jucut\\concat.txt del temp_jucut\\concat.txt',
  ];

  state.activeSegments.forEach((seg, i) => {
    const chunkName = `temp_jucut\\part_${String(i).padStart(4, '0')}.${ext}`;
    const dur = (seg.end - seg.start).toFixed(4);
    const start = seg.start.toFixed(4);
    lines.push(
      `%FFMPEG% -y -ss ${start} -i "${filename}" -t ${dur} -c copy -avoid_negative_ts make_zero "${chunkName}" -loglevel error`
    );
    lines.push(
      `echo file 'part_${String(i).padStart(4, '0')}.${ext}' >> temp_jucut\\concat.txt`
    );
  });

  lines.push(
    'echo  [*] Concatenando video final...',
    `%FFMPEG% -y -f concat -safe 0 -i temp_jucut\\concat.txt -c copy "${outName}" -loglevel error`,
    'echo  [*] Limpando arquivos temporarios...',
    'rmdir /s /q temp_jucut',
    'echo.',
    'echo ========================================================',
    'echo  [OK] Video cortado com sucesso em poucos segundos!',
    `echo  Arquivo salvo: "${outName}"`,
    'echo ========================================================',
    'pause'
  );

  const scriptContent = lines.join('\r\n');
  const blob = new Blob([scriptContent], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cortar_${baseName}.bat`;
  a.click();
  showToast('Script .BAT baixado! Coloque na mesma pasta do vídeo e execute com 2 cliques.', 'success');
}

function downloadPythonScript() {
  if (!state.videoFile || !state.activeSegments.length) {
    showToast('Nenhum corte para exportar.', 'warning');
    return;
  }
  const filename = state.videoFile.name;
  const baseName = filename.replace(/\.[^.]+$/, '');
  const ext = filename.split('.').pop() || 'mp4';
  const outName = `${baseName}_cortado.${ext}`;
  const segsJson = JSON.stringify(state.activeSegments, null, 2);

  const pyContent = `#!/usr/bin/env python3
# JuCut — Corte Ultra-Rápido de Silêncios via FFmpeg Nativo
import os, sys, subprocess, shutil

VIDEO_IN = r"${filename}"
VIDEO_OUT = r"${outName}"
SEGMENTS = ${segsJson}

def find_ffmpeg():
    if os.path.exists("ffmpeg.exe"):
        return os.path.abspath("ffmpeg.exe")
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except:
        pass
    print("[ERRO] FFmpeg não encontrado. Coloque ffmpeg.exe nesta mesma pasta.")
    sys.exit(1)

def main():
    ff = find_ffmpeg()
    print("=" * 55)
    print("  JuCut — Corte de Silêncios")
    print(f"  Vídeo : {VIDEO_IN}")
    print(f"  Total : {len(SEGMENTS)} segmentos")
    print("=" * 55)
    temp_dir = "temp_jucut"
    os.makedirs(temp_dir, exist_ok=True)
    concat_list = os.path.join(temp_dir, "concat.txt")

    with open(concat_list, "w", encoding="utf-8") as cl:
        for i, s in enumerate(SEGMENTS):
            chunk = os.path.join(temp_dir, f"part_{i:04d}.${ext}")
            dur = s["end"] - s["start"]
            cmd = [ff, "-y", "-ss", str(s["start"]), "-i", VIDEO_IN, "-t", str(dur), "-c", "copy", "-avoid_negative_ts", "make_zero", chunk, "-loglevel", "error"]
            subprocess.run(cmd, check=True)
            cl.write(f"file '{os.path.basename(chunk)}'\\n")
            print(f"\\rCortando segmentos: {i+1}/{len(SEGMENTS)}...", end="", flush=True)

    print("\\nConcatenando vídeo final...")
    subprocess.run([ff, "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", VIDEO_OUT, "-loglevel", "error"], check=True)
    shutil.rmtree(temp_dir)
    print(f"[OK] Vídeo pronto: {VIDEO_OUT}")

if __name__ == "__main__":
    main()
`;

  const blob = new Blob([pyContent], { type: 'text/x-python' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cortar_${baseName}.py`;
  a.click();
  showToast('Script Python baixado!', 'success');
}

// ─── 12. Local Native Export (Ultra-Fast) ──────────────────────────────────
async function exportWithLocalServer() {
  if (!state.videoFile || !state.activeSegments.length) {
    showToast('Nada a exportar.', 'warning');
    return;
  }

  els.btnStartExport.disabled = true;
  els.exportProgressWrap.style.display = 'flex';
  els.exportProgressFill.style.width = '10%';
  els.exportProgressPct.textContent = '10%';
  els.exportProgressText.textContent = 'Enviando vídeo para o FFmpeg nativo local...';
  setStatus('Processando localmente...', 'working');

  try {
    const formData = new FormData();
    formData.append('video', state.videoFile);
    formData.append('metadata', JSON.stringify({
      filename: state.videoFile.name,
      segments: state.activeSegments,
      speed: parseFloat(els.sliderSpeed.value),
      format: state.exportFormat,
      mode: state.exportMode,
    }));

    // Poll progress
    const progressTimer = setInterval(async () => {
      try {
        const pr = await fetch('/api/progress');
        if (pr.ok) {
          const pData = await pr.json();
          if (pData.progress) {
            updateExportProgress(pData.progress);
            if (pData.status) els.exportProgressText.textContent = pData.status;
          }
        }
      } catch (e) {}
    }, 400);

    const res = await fetch('/api/export', {
      method: 'POST',
      body: formData,
    });
    clearInterval(progressTimer);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro no servidor local');
    }

    const data = await res.json();
    updateExportProgress(100);
    els.exportProgressText.textContent = '✅ Concluído em poucos segundos!';

    // Download do vídeo renderizado
    const a = document.createElement('a');
    a.href = data.download_url;
    a.download = data.filename;
    a.click();

    setStatus('Exportação concluída!', 'success');
    showToast(`Vídeo exportado com sucesso via FFmpeg Nativo! (${data.size_mb} MB) 🎉`, 'success');
    els.btnCancelExport.textContent = 'Fechar';
    els.btnStartExport.disabled = false;
  } catch (err) {
    console.error('Local export error:', err);
    els.exportProgressText.textContent = '❌ Erro: ' + err.message;
    setStatus('Erro na exportação local', 'error');
    showToast('Erro no motor local. Tente baixar o Script .BAT de corte!', 'warning');
    els.btnStartExport.disabled = false;
  }
}

function updateExportProgress(pct) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  if (els.exportProgressFill) els.exportProgressFill.style.width = p + '%';
  if (els.exportProgressPct) els.exportProgressPct.textContent = p + '%';
}

// ─── 12b. WebAssembly Browser Export (Fallback) ───────────────────────────
async function exportWithWasm() {
  if (!state.videoFile || !state.activeSegments.length) {
    showToast('Nenhum corte selecionado.', 'warning');
    return;
  }

  if (!state.ffmpegReady || !state.ffmpeg) {
    showToast('FFmpeg WebAssembly não disponível no navegador. Baixe o Script .BAT para exportação instantânea!', 'warning');
    selectExportMethod('script');
    return;
  }

  els.btnStartExport.disabled = true;
  els.exportProgressWrap.style.display = 'flex';
  updateExportProgress(5);
  els.exportProgressText.textContent = 'Carregando vídeo na memória do navegador...';
  setStatus('Processando via WebAssembly...', 'working');

  try {
    const fetchFile = getFetchFile();
    const ffmpeg = state.ffmpeg;
    const ext = state.videoFile.name.split('.').pop() || 'mp4';
    const inName = `input.${ext}`;
    const outName = `output.${ext}`;

    ffmpeg.FS('writeFile', inName, await fetchFile(state.videoFile));

    updateExportProgress(20);
    els.exportProgressText.textContent = 'Renderizando cortes de silêncio...';

    const filterParts = [];
    const concatParts = [];
    state.activeSegments.forEach((seg, i) => {
      filterParts.push(`[0:v]trim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
      filterParts.push(`[0:a]atrim=start=${seg.start.toFixed(3)}:end=${seg.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      concatParts.push(`[v${i}][a${i}]`);
    });
    const filterComplex = `${filterParts.join(';')};${concatParts.join('')}concat=n=${state.activeSegments.length}:v=1:a=1[outv][outa]`;

    ffmpeg.setProgress(({ ratio }) => {
      const pct = Math.min(99, Math.round(20 + ratio * 75));
      updateExportProgress(pct);
      els.exportProgressText.textContent = `Renderizando vídeo: ${pct}%`;
    });

    await ffmpeg.run(
      '-i', inName,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '26',
      '-c:a', 'aac',
      outName
    );

    const data = ffmpeg.FS('readFile', outName);
    const blob = new Blob([data.buffer], { type: `video/${ext}` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.videoFile.name.replace(/\.[^.]+$/, '')}_cortado.${ext}`;
    a.click();

    updateExportProgress(100);
    els.exportProgressText.textContent = '✅ Concluído!';
    setStatus('Exportação concluída!', 'success');
    showToast('Vídeo exportado com sucesso no navegador!', 'success');
    els.btnCancelExport.textContent = 'Fechar';
  } catch (err) {
    console.error('WASM export error:', err);
    els.exportProgressText.textContent = 'Falha no WebAssembly. Baixe o Script .BAT para corte em 3 segundos!';
    showToast('Falha no WebAssembly. Recomendamos baixar o Script .BAT de 3 segundos!', 'warning');
  } finally {
    els.btnStartExport.disabled = false;
  }
}

// ─── 12c. Main Export Router ──────────────────────────────────────────────
function startExport() {
  if (state.exportMethod === 'local') {
    exportWithLocalServer();
  } else if (state.exportMethod === 'wasm') {
    exportWithWasm();
  } else {
    downloadBatchScript();
  }
}

// ─── 13. Slider Live Updates ───────────────────────────────────────────────
function setupSliders() {
  els.sliderThreshold.addEventListener('input', () => {
    els.valThreshold.textContent = els.sliderThreshold.value + ' dB';
  });
  els.sliderMinDur.addEventListener('input', () => {
    els.valMinDur.textContent = parseFloat(els.sliderMinDur.value).toFixed(2) + 's';
  });
  els.sliderPadding.addEventListener('input', () => {
    els.valPadding.textContent = parseFloat(els.sliderPadding.value).toFixed(2) + 's';
  });
  els.sliderSpeed.addEventListener('input', () => {
    els.valSpeed.textContent = parseFloat(els.sliderSpeed.value).toFixed(2) + '×';
  });
}

// ─── 13. Export Options & Local Engine Controls ───────────────────────────
function setupExportOptions() {
  // Method selection cards
  document.querySelectorAll('.method-card').forEach(card => {
    card.addEventListener('click', () => {
      selectExportMethod(card.dataset.method);
    });
  });

  // Refresh engine status button
  if (els.btnRefreshEngine) {
    els.btnRefreshEngine.addEventListener('click', () => {
      checkLocalEngine().then(online => {
        if (online) showToast('Motor local conectado com sucesso!', 'success');
        else showToast('Servidor local não encontrado em localhost:8765. Inicie com iniciar.bat', 'warning');
      });
    });
  }

  // Script download buttons
  if (els.btnDlBat) {
    els.btnDlBat.addEventListener('click', downloadBatchScript);
  }
  if (els.btnDlPy) {
    els.btnDlPy.addEventListener('click', downloadPythonScript);
  }

  // Fast vs Reencode pills
  if (els.pillFast && els.pillReencode) {
    els.pillFast.addEventListener('click', () => {
      els.pillFast.classList.add('active');
      els.pillReencode.classList.remove('active');
      state.exportMode = 'fast';
    });
    els.pillReencode.addEventListener('click', () => {
      els.pillReencode.classList.add('active');
      els.pillFast.classList.remove('active');
      state.exportMode = 'reencode';
    });
  }

  // Format pills
  document.querySelectorAll('.pill[data-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-format]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.exportFormat = btn.dataset.format;
    });
  });
}

// ─── 14. Mobile Navigation & Drawer ─────────────────────────────────────────
function setupMobileNav() {
  const navBtns = document.querySelectorAll('.mobile-nav-btn');
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      if (els.mainLayout) els.mainLayout.dataset.mobileTab = tab;

      // Close drawer if open
      document.body.classList.remove('drawer-open');
      if (els.drawerBackdrop) els.drawerBackdrop.classList.remove('active');

      if (tab === 'editor') {
        setTimeout(() => {
          if (state.videoDuration) {
            drawTimeline();
            updatePlayhead();
          }
        }, 80);
      } else if (tab === 'silence') {
        const silenceSec = document.getElementById('section-silence');
        if (silenceSec) silenceSec.scrollIntoView({ behavior: 'smooth' });
      } else if (tab === 'stats') {
        const statsSec = document.getElementById('section-stats');
        if (statsSec) statsSec.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // Drawer toggle button in topbar
  if (els.mobileTogglePanel) {
    els.mobileTogglePanel.addEventListener('click', () => {
      const isOpen = document.body.classList.toggle('drawer-open');
      if (els.drawerBackdrop) {
        els.drawerBackdrop.classList.toggle('active', isOpen);
      }
    });
  }

  // Drawer backdrop click to close
  if (els.drawerBackdrop) {
    els.drawerBackdrop.addEventListener('click', () => {
      document.body.classList.remove('drawer-open');
      els.drawerBackdrop.classList.remove('active');
    });
  }
}

// ─── 15. Window Resize ─────────────────────────────────────────────────────
function setupResize() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // If resized back to desktop, remove drawer classes
      if (window.innerWidth > 900) {
        document.body.classList.remove('drawer-open');
        if (els.drawerBackdrop) els.drawerBackdrop.classList.remove('active');
      }
      if (state.videoDuration) drawTimeline();
    }, 150);
  });
}

// ─── INIT ──────────────────────────────────────────────────────────────────
async function init() {
  setupDropZone();
  setupTransport();
  setupZoom();
  setupSliders();
  setupExportOptions();
  setupMobileNav();
  setupResize();

  // Wire up buttons
  els.btnDetect.addEventListener('click', () => {
    setStatus('Detectando silêncios...', 'working');
    showOverlay('Analisando...');
    setTimeout(() => {
      try {
        detectSilences();
      } catch (e) {
        showToast('Erro: ' + e.message, 'error');
        console.error(e);
      }
      hideOverlay();
    }, 50);
  });

  els.btnRemoveSilence.addEventListener('click', removeSilences);
  els.btnUndoRemove.addEventListener('click',    undoRemoveSilences);
  els.btnExport.addEventListener('click',        openExportModal);
  els.modalClose.addEventListener('click',       closeExportModal);
  els.btnCancelExport.addEventListener('click',  closeExportModal);
  els.btnStartExport.addEventListener('click',   startExport);

  els.exportModal.addEventListener('click', e => {
    if (e.target === els.exportModal) closeExportModal();
  });

  // Always dismiss splash screen within 500ms so editor opens instantly on GitHub Pages
  setTimeout(dismissSplashScreen, 500);

  // Initialize background tasks without blocking UI
  initFFmpeg();
  checkLocalEngine();
}

init();
