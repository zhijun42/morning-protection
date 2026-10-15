import { DEFAULTS, getConfig, normalizeDomains, isBlockedNow, nextUnlockAt, toMinutes } from './config.js';

const fields = {
  blockStart: document.getElementById('blockStart'),
  blockEnd: document.getElementById('blockEnd'),
  domains: document.getElementById('domains'),
  enabled: document.getElementById('enabled'),
};
const statusEl = document.getElementById('status');
const savedEl = document.getElementById('saved');

function renderStatus(config) {
  if (!config.enabled) {
    statusEl.innerHTML = '屏蔽已<b>关闭</b>。';
    return;
  }
  if (isBlockedNow(config)) {
    const unlockAt = nextUnlockAt(config);
    const hours = Math.floor((unlockAt - new Date()) / 3600000);
    const minutes = Math.ceil(((unlockAt - new Date()) % 3600000) / 60000);
    statusEl.innerHTML = `现在<b>屏蔽中</b>，约 ${hours} 小时 ${minutes} 分钟后解锁。`;
  } else {
    statusEl.innerHTML = `现在<b>可访问</b>，${config.blockStart} 起进入屏蔽时段。`;
  }
}

async function load() {
  const config = await getConfig();
  fields.blockStart.value = config.blockStart;
  fields.blockEnd.value = config.blockEnd;
  fields.domains.value = config.domains.join('\n');
  fields.enabled.checked = config.enabled;
  renderStatus(config);
}

document.getElementById('save').addEventListener('click', async () => {
  const next = {
    blockStart: toMinutes(fields.blockStart.value) === null ? DEFAULTS.blockStart : fields.blockStart.value,
    blockEnd: toMinutes(fields.blockEnd.value) === null ? DEFAULTS.blockEnd : fields.blockEnd.value,
    domains: normalizeDomains(fields.domains.value),
    enabled: fields.enabled.checked,
  };
  await chrome.storage.sync.set(next);
  await load();
  savedEl.textContent = '已保存';
  setTimeout(() => (savedEl.textContent = ''), 2000);
});

load();
