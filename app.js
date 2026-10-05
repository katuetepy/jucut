/**
 * JuCut — app.js
 * Main application logic: FFmpeg.wasm loading, audio analysis,
 * silence detection, timeline rendering, and video export.
 */

// ─── FFmpeg.wasm (via CDN, no bundler needed) ─────────────────────────────
// Exposed as window.FFmpeg by the CDN script
const { createFFmpeg, fetchFile } = FFmpeg;

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

// ─── 1. FFmpeg Initialization ──────────────────────────────────────────────
async function initFFmpeg() {
  try {
    const ffmpeg = createFFmpeg({
      log: false,
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
      progress: ({ ratio }) => {
        const pct = Math.round(ratio * 100);
        els.loadingBar.style.width = pct + '%';
      },
    });

    els.loadingText.textContent = 'Baixando FFmpeg Core...';
    els.loadingBar.style.width = '10%';

    await ffmpeg.load();
    state.ffmpeg = ffmpeg;
    state.ffmpegReady = true;

    els.loadingBar.style.width = '100%';
    els.loadingText.textContent = 'Pronto!';
    await sleep(600);

    els.ffmpegLoading.classList.add('fade-out');
    setTimeout(() => els.ffmpegLoading.remove(), 700);

    setStatus('FFmpeg pronto', 'success');
    showToast('JuCut pronto! Carregue um vídeo para começar.', 'success');
  } catch (err) {
    console.error('FFmpeg load error:', err);
    els.loadingText.textContent = 'Erro ao carregar FFmpeg. Verifique sua conexão.';
    setStatus('Erro FFmpeg', 'error');
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

  // Click on timeline to seek
  els.timelineTracks.addEventListener('click', e => {
    const rect = els.timelineTracks.getBoundingClientRect();
    const x = e.clientX - rect.left + els.timelineTracks.scrollLeft;
    const t = x / getPx();
    seek(t);
  });

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

// ─── 10. Export Modal ──────────────────────────────────────────────────────
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
}

function closeExportModal() {
  els.exportModal.style.display = 'none';
}

// ─── 11. FFmpeg Export ────────────────────────────────────────────────────
async function startExport() {
  if (!state.ffmpegReady || !state.videoFile || !state.activeSegments.length) {
    showToast('Nada a exportar.', 'warning');
    return;
  }

  els.btnStartExport.disabled = true;
  els.exportProgressWrap.style.display = 'flex';
  els.exportProgressFill.style.width = '0%';
  els.exportProgressText.textContent = 'Carregando arquivo no FFmpeg...';
  setStatus('Exportando...', 'working');

  try {
    const ff = state.ffmpeg;
    const ext = state.videoFile.name.split('.').pop() || 'mp4';
    const inputName  = `input.${ext}`;
    const outputName = `output.${state.exportFormat}`;

    // Write input
    els.exportProgressText.textContent = 'Carregando vídeo...';
    updateExportProgress(5);
    ff.FS('writeFile', inputName, await fetchFile(state.videoFile));

    // Build filter_complex for concat
    const segs = state.activeSegments;
    const speed = parseFloat(els.sliderSpeed.value);
    const n = segs.length;

    const qualityMap = {
      high:   { crf: '18', audioBitrate: '192k' },
      medium: { crf: '23', audioBitrate: '128k' },
      low:    { crf: '28', audioBitrate: '96k' },
    };
    const q = qualityMap[state.exportQuality];

    els.exportProgressText.textContent = 'Montando filtros FFmpeg...';
    updateExportProgress(10);

    // Build trim + concat filter
    let filterParts = [];
    for (let i = 0; i < n; i++) {
      const { start, end } = segs[i];
      filterParts.push(`[0:v]trim=start=${start.toFixed(4)}:end=${end.toFixed(4)},setpts=PTS-STARTPTS[v${i}];`);
      filterParts.push(`[0:a]atrim=start=${start.toFixed(4)}:end=${end.toFixed(4)},asetpts=PTS-STARTPTS[a${i}];`);
    }

    const vInputs = segs.map((_, i) => `[v${i}]`).join('');
    const aInputs = segs.map((_, i) => `[a${i}]`).join('');

    // Speed filter
    let vConcat, aConcat;
    if (Math.abs(speed - 1.0) > 0.01) {
      filterParts.push(`${vInputs}concat=n=${n}:v=1:a=0[vconcat];`);
      filterParts.push(`${aInputs}concat=n=${n}:v=0:a=1[aconcat];`);
      filterParts.push(`[vconcat]setpts=${(1/speed).toFixed(4)}*PTS[vout];`);
      filterParts.push(`[aconcat]atempo=${Math.min(2.0, speed).toFixed(4)}[aout]`);
      if (speed > 2.0) {
        // chain atempo for speed > 2
        filterParts[filterParts.length - 1] = `[aconcat]atempo=2.0,atempo=${(speed / 2.0).toFixed(4)}[aout]`;
      }
      vConcat = '[vout]';
      aConcat = '[aout]';
    } else {
      filterParts.push(`${vInputs}concat=n=${n}:v=1:a=0[vout];`);
      filterParts.push(`${aInputs}concat=n=${n}:v=0:a=1[aout]`);
      vConcat = '[vout]';
      aConcat = '[aout]';
    }

    const filterComplex = filterParts.join('');

    // Set progress callback
    ff.setProgress(({ ratio }) => {
      const pct = Math.round(10 + ratio * 85);
      updateExportProgress(pct);
      els.exportProgressText.textContent = `FFmpeg: ${pct}%`;
    });

    const args = [
      '-i', inputName,
      '-filter_complex', filterComplex,
      '-map', vConcat,
      '-map', aConcat,
    ];

    if (state.exportFormat === 'mp4') {
      args.push('-c:v', 'libx264', '-crf', q.crf, '-preset', 'fast',
                '-c:a', 'aac', '-b:a', q.audioBitrate,
                '-movflags', '+faststart');
    } else {
      args.push('-c:v', 'libvpx-vp9', '-crf', q.crf, '-b:v', '0',
                '-c:a', 'libopus', '-b:a', q.audioBitrate);
    }

    args.push('-y', outputName);

    els.exportProgressText.textContent = 'Processando com FFmpeg (pode demorar)...';
    await ff.run(...args);

    updateExportProgress(98);
    els.exportProgressText.textContent = 'Lendo arquivo de saída...';

    const data = ff.FS('readFile', outputName);
    const blob = new Blob([data.buffer], {
      type: state.exportFormat === 'mp4' ? 'video/mp4' : 'video/webm'
    });

    // Cleanup
    ff.FS('unlink', inputName);
    ff.FS('unlink', outputName);

    updateExportProgress(100);
    els.exportProgressText.textContent = '✅ Concluído!';

    // Trigger download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = state.videoFile.name.replace(/\.[^.]+$/, '');
    a.href = url;
    a.download = `${baseName}_jucut.${state.exportFormat}`;
    a.click();
    URL.revokeObjectURL(url);

    setStatus('Exportação concluída!', 'success');
    showToast('Vídeo exportado com sucesso! 🎉', 'success');
    els.btnCancelExport.textContent = 'Fechar';
    els.btnStartExport.disabled = false;

  } catch (err) {
    console.error('Export error:', err);
    els.exportProgressText.textContent = '❌ Erro: ' + err.message;
    setStatus('Erro na exportação', 'error');
    showToast('Erro na exportação: ' + err.message, 'error');
    els.btnStartExport.disabled = false;
  }
}

function updateExportProgress(pct) {
  els.exportProgressFill.style.width = pct + '%';
  els.exportProgressPct.textContent  = pct + '%';
}

// ─── 12. Slider Live Updates ───────────────────────────────────────────────
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

// ─── 13. Export Options (pills) ────────────────────────────────────────────
function setupExportOptions() {
  document.querySelectorAll('.pill[data-format]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-format]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.exportFormat = btn.dataset.format;
    });
  });
  document.querySelectorAll('.pill[data-quality]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-quality]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.exportQuality = btn.dataset.quality;
    });
  });
}

// ─── 14. Window Resize ─────────────────────────────────────────────────────
function setupResize() {
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
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

  await initFFmpeg();
}

init();
