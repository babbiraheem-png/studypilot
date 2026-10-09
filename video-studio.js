(function () {
  const SCENES = [
    { title: '1 · The big question', generic: 'Open with a curious, child-friendly visual hook that introduces the main topic.' },
    { title: '2 · Meet the key parts', generic: 'Show the most important parts or ingredients of the topic with simple, accurate visual labels represented by icons, not text.' },
    { title: '3 · Where it begins', generic: 'Animate the first step of the process or explain the basic idea through a clear visual analogy.' },
    { title: '4 · Watch the process', generic: 'Show the central mechanism step by step using arrows, movement, and simple shapes.' },
    { title: '5 · The important change', generic: 'Visualize the key transformation or cause-and-effect relationship in a scientifically accurate way.' },
    { title: '6 · A real-world example', generic: 'Connect the concept to a familiar everyday example a Class 7 student can understand.' },
    { title: '7 · Common mix-up', generic: 'Illustrate one likely misconception and visually contrast it with the correct idea.' },
    { title: '8 · Quick recap', generic: 'End with a satisfying visual recap of the main idea and its most important takeaway.' }
  ];

  const PHOTOSYNTHESIS_SCENES = [
    'A tiny seedling droops in a sunny school garden. Camera gently zooms toward a bright green leaf; cheerful animated science-explainer style. Establish the question: how does a plant make its own food?',
    'Show warm sunlight rays reaching a broad green leaf. Inside the leaf, reveal chloroplasts as tiny green structures in plant cells. Keep the visuals simple and scientifically accurate.',
    'Follow blue water droplets from the soil into fine roots and up the stem to the leaves. Use flowing animated arrows to show the movement of water.',
    'Show carbon dioxide molecules in the air moving through tiny leaf pores called stomata. Use simple molecule icons and a clear close-up of the leaf surface.',
    'Inside a leaf cell, show green chlorophyll capturing sunlight energy. The energy gently illuminates the scene as water and carbon dioxide move toward the photosynthesis process.',
    'Animate the plant using light energy to make glucose (sugar) in its leaves. Show sugar molecules moving through the plant as stored food and energy; avoid chemical-equation text.',
    'Show oxygen molecules being released from the leaf into the air. A child takes a breath nearby; keep the animation calm and accurate, without suggesting plants only produce oxygen in daylight-free conditions.',
    'Finish with one complete visual: sunlight, water, carbon dioxide entering the plant; glucose made inside the leaf; oxygen released. End on a healthy green plant in a garden.'
  ];

  const byId = id => document.getElementById(id);
  let busy = false;

  function setStatus(message, kind) {
    const el = byId('videoStudioStatus');
    if (!el) return;
    el.textContent = message;
    el.className = 'video-status' + (kind ? ' ' + kind : '');
  }

  function updateButton() {
    const button = byId('videoGenerateBtn');
    if (!button) return;
    const consent = Boolean(byId('videoCostConsent')?.checked);
    const ready = byId('videoStudioReady')?.dataset.ready === 'true';
    button.disabled = busy || !ready || !consent;
    button.textContent = busy ? 'Generating lesson clips…' : 'Generate 1-minute lesson';
  }

  async function loadVideoStudio() {
    const readyEl = byId('videoStudioReady');
    if (!readyEl || readyEl.dataset.checked === 'true') return;
    readyEl.dataset.checked = 'true';
    setStatus('Checking secure video service…');
    try {
      const response = await fetch('/api/video?action=health', { cache: 'no-store' });
      const data = await response.json();
      const ready = Boolean(response.ok && data.enabled);
      readyEl.dataset.ready = ready ? 'true' : 'false';
      if (ready) {
        readyEl.textContent = 'Video API configured · Veo 3.1 Lite · 720p';
        readyEl.className = 'video-config-status ready';
        setStatus('Ready for approved test accounts. Generation uses a paid API.', 'success');
      } else {
        readyEl.textContent = 'Video generation is safely disabled';
        readyEl.className = 'video-config-status';
        setStatus('The interface is ready, but the owner must configure video billing and explicitly enable the backend before clips can be generated.', 'warning');
      }
    } catch {
      readyEl.dataset.ready = 'false';
      readyEl.textContent = 'Could not reach /api/video';
      readyEl.className = 'video-config-status';
      setStatus('The video API route is not available on this deployment yet.', 'warning');
    }
    updateButton();
  }

  function scenePrompts(topic) {
    const isPhoto = /photosynthesis/i.test(topic);
    const grade = /class\s*\d+/i.test(topic) ? '' : ' for Class 7';
    const directions = isPhoto ? PHOTOSYNTHESIS_SCENES : SCENES.map(s => s.generic);
    return directions.map((direction, index) => ({
      title: SCENES[index].title,
      prompt: 'Topic: ' + topic + grade + '. Scene ' + (index + 1) + ' of 8 in one coherent educational animated explainer. ' + direction +
        ' Maintain consistent characters, palette, and visual style across scenes. English-learning context. No legible on-screen text; captions will be added separately.'
    }));
  }

  function renderSceneList(scenes) {
    const list = byId('videoSceneList');
    if (!list) return;
    list.replaceChildren();
    scenes.forEach((scene, index) => {
      const item = document.createElement('div');
      item.className = 'video-scene-row';
      const number = document.createElement('span');
      number.className = 'video-scene-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('div');
      title.className = 'video-scene-copy';
      const strong = document.createElement('b');
      strong.textContent = scene.title;
      const note = document.createElement('span');
      note.textContent = scene.status || 'Waiting for generation';
      note.id = 'videoSceneStatus' + index;
      title.append(strong, note);
      const badge = document.createElement('span');
      badge.className = 'video-scene-badge';
      badge.id = 'videoSceneBadge' + index;
      badge.textContent = scene.badge || 'Planned';
      item.append(number, title, badge);
      list.append(item);
    });
  }

  function updateScene(index, status, badge) {
    const statusEl = byId('videoSceneStatus' + index);
    const badgeEl = byId('videoSceneBadge' + index);
    if (statusEl) statusEl.textContent = status;
    if (badgeEl) {
      badgeEl.textContent = badge;
      badgeEl.className = 'video-scene-badge' + (badge === 'Ready' ? ' ready' : badge === 'Error' ? ' error' : '');
    }
  }

  async function apiJson(url, options) {
    const response = await fetch(url, options || {});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Video request failed.');
    return data;
  }

  function renderClip(index, scene, videoUrl) {
    const output = byId('videoOutput');
    if (!output) return;
    const card = document.createElement('article');
    card.className = 'card video-clip-card';
    const heading = document.createElement('div');
    heading.className = 'card-title';
    const title = document.createElement('h3');
    title.textContent = scene.title;
    const tag = document.createElement('span');
    tag.textContent = 'Scene ' + (index + 1);
    heading.append(title, tag);
    const player = document.createElement('video');
    player.controls = true;
    player.preload = 'metadata';
    player.playsInline = true;
    player.src = videoUrl;
    player.setAttribute('aria-label', scene.title);
    const download = document.createElement('a');
    download.href = videoUrl;
    download.download = 'studypilot-photosynthesis-scene-' + (index + 1) + '.mp4';
    download.className = 'btn video-download';
    download.textContent = 'Download clip';
    card.append(heading, player, download);
    output.append(card);
  }

  async function startVideoLesson() {
    if (busy) return;
    const topic = byId('videoTopic')?.value.trim() || '';
    if (topic.length < 3 || topic.length > 120) {
      setStatus('Enter a topic between 3 and 120 characters.', 'warning');
      return;
    }
    if (!byId('videoCostConsent')?.checked) {
      setStatus('Please confirm you understand that video generation is paid.', 'warning');
      return;
    }

    const health = await apiJson('/api/video?action=health', { cache: 'no-store' }).catch(error => {
      setStatus(error.message, 'error');
      return null;
    });
    if (!health || !health.enabled) {
      setStatus('Video generation is disabled until the owner configures and explicitly enables the paid API.', 'warning');
      return;
    }

    busy = true;
    updateButton();
    byId('videoOutput')?.replaceChildren();
    const scenes = scenePrompts(topic);
    renderSceneList(scenes);
    setStatus('Starting 8 short scenes. This can take several minutes and will incur provider charges.', 'warning');

    try {
      const jobs = [];
      for (let i = 0; i < scenes.length; i++) {
        updateScene(i, 'Sending scene request…', 'Starting');
        const started = await apiJson('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', topic, prompt: scenes[i].prompt })
        });
        jobs.push({ index: i, operation: started.operation, done: false });
        updateScene(i, 'Video job queued', 'Processing');
      }

      const deadline = Date.now() + 12 * 60 * 1000;
      while (jobs.some(job => !job.done) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        await Promise.all(jobs.filter(job => !job.done).map(async job => {
          try {
            const result = await apiJson('/api/video?action=status&operation=' + encodeURIComponent(job.operation), { cache: 'no-store' });
            if (result.done && result.error) {
              job.done = true;
              job.error = result.error;
              updateScene(job.index, result.error, 'Error');
            } else if (result.done && result.videoUrl) {
              job.done = true;
              job.videoUrl = result.videoUrl;
              updateScene(job.index, 'Clip ready to preview or download', 'Ready');
              renderClip(job.index, scenes[job.index], result.videoUrl);
            } else {
              updateScene(job.index, 'Generating animation…', 'Processing');
            }
          } catch (error) {
            job.done = true;
            job.error = error.message;
            updateScene(job.index, error.message, 'Error');
          }
        }));
        setStatus(jobs.filter(j => j.done && j.videoUrl).length + ' of 8 clips ready. Keep this page open while generation runs.', 'warning');
      }

      const ready = jobs.filter(j => j.videoUrl).length;
      const failed = jobs.filter(j => j.error).length;
      if (jobs.some(j => !j.done)) {
        setStatus(ready + ' clips ready; some jobs are still running. Retry status by starting a new lesson later if needed.', 'warning');
      } else if (ready === 8) {
        setStatus('All 8 scene clips are ready. This version provides separate clips; it does not merge them into one MP4.', 'success');
      } else {
        setStatus(ready + ' clips ready, ' + failed + ' scene(s) failed. Only successfully generated clips are billed by the provider according to its published policy.', 'warning');
      }
    } catch (error) {
      setStatus(error.message + ' If this is an account error, sign in with an owner-approved test account.', 'error');
    } finally {
      busy = false;
      updateButton();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    byId('videoCostConsent')?.addEventListener('change', updateButton);
    byId('videoGenerateBtn')?.addEventListener('click', startVideoLesson);
    document.querySelector('[data-view="videoStudio"]')?.addEventListener('click', loadVideoStudio);
    renderSceneList(scenePrompts(byId('videoTopic')?.value || 'Photosynthesis for Class 7'));
    loadVideoStudio();
    updateButton();
  });

  window.loadVideoStudio = loadVideoStudio;
})();
