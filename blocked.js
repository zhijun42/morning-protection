import { getConfig, isBlockedNow, nextUnlockAt } from './config.js';

const countdownEl = document.getElementById('countdown');
const hintEl = document.getElementById('unlock-hint');
const titleEl = document.getElementById('title');
const subtitleEl = document.getElementById('subtitle');
const windowEl = document.getElementById('window');
let restoreRequested = false;

document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function formatRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((n) => String(n).padStart(2, '0')).join(':');
}

async function render() {
  const config = await getConfig();
  windowEl.textContent = `屏蔽时段 ${config.blockStart} – ${config.blockEnd} · ${config.domains.join('、')}`;

  if (!isBlockedNow(config)) {
    titleEl.textContent = '已经解锁了';
    subtitleEl.textContent = '正在自动返回原来的页面…';
    countdownEl.textContent = '00:00:00';
    hintEl.textContent = '';
    if (!restoreRequested) {
      restoreRequested = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: 'restore-blocked-tabs' });
        if (!response?.ok) throw new Error('Restoration request failed');
      } catch {
        restoreRequested = false;
        subtitleEl.textContent = '已经解锁，可使用浏览器后退返回。';
      }
    }
    return;
  }

  restoreRequested = false;
  titleEl.textContent = '这段时间留给自己';
  subtitleEl.textContent = '这个网站现在不开放，结束后会自动返回。';
  const unlockAt = nextUnlockAt(config);
  countdownEl.textContent = formatRemaining(unlockAt - new Date());
  hintEl.textContent = `距离解锁（${config.blockEnd}）`;
}

render();
setInterval(render, 1000);
