import { getConfig, isBlockedNow, hostMatches, nextBoundaryAt } from './config.js';

const ALARM_NAME = 'morning-protection-tick';
const BOUNDARY_ALARM_NAME = 'morning-protection-boundary';
const RULE_ID_BASE = 1;
const BLOCKED_PAGE = chrome.runtime.getURL('blocked.html');
const restoringTabs = new Map();
let syncQueue = Promise.resolve();

function getBlockedPage(url) {
  if (!url || url.split(/[?#]/, 1)[0] !== BLOCKED_PAGE) return null;
  return new URL(url);
}

function getOriginalUrl(page) {
  try {
    const original = new URL(page.hash.slice(1));
    return ['http:', 'https:'].includes(original.protocol) ? original.href : null;
  } catch {
    return null;
  }
}

async function replaceRules(config) {
  const shouldBlock = isBlockedNow(config);
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = shouldBlock
    ? config.domains.map((domain, index) => ({
        id: RULE_ID_BASE + index,
        priority: 1,
        action: {
          type: 'redirect',
          // Keep the destination with the tab so it survives browser restarts and tab duplication.
          redirect: { regexSubstitution: `${BLOCKED_PAGE}#\\0` },
        },
        condition: {
          requestDomains: [domain],
          regexFilter: '^https?://.*',
          resourceTypes: ['main_frame'],
        },
      }))
    : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules,
  });
  return shouldBlock;
}

async function redirectOpenTabs(config) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    try {
      const current = await chrome.tabs.get(tab.id);
      const original = new URL(current.pendingUrl || current.url);
      if (!['http:', 'https:'].includes(original.protocol)) continue;
      if (hostMatches(original.hostname, config.domains)) {
        const restoreMode = current.pendingUrl ? '' : '?restore=back';
        await chrome.tabs.update(tab.id, { url: `${BLOCKED_PAGE}${restoreMode}#${original.href}` });
      }
    } catch (error) {
      console.warn(`Morning Protection: could not block tab ${tab.id}`, error);
    }
  }
}

async function restoreOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !getBlockedPage(tab.url)) continue;
    try {
      const current = await chrome.tabs.get(tab.id);
      const page = getBlockedPage(current.pendingUrl || current.url);
      if (!page) continue;
      if (restoringTabs.get(tab.id) === page.href) continue;
      // Chrome resolves navigation calls before committing the new URL; concurrent requests must wait for that commit.
      restoringTabs.set(tab.id, page.href);
      const originalUrl = getOriginalUrl(page);
      // Older blocking pages have no saved URL; their browser history is the only recovery path.
      if (page.searchParams.get('restore') === 'back' || !page.hash) {
        try {
          await chrome.tabs.goBack(tab.id);
          const restored = await chrome.tabs.get(tab.id);
          if (!originalUrl || (restored.pendingUrl || restored.url) === originalUrl) continue;
        } catch (error) {
          if (!originalUrl) throw error;
        }
      }
      if (originalUrl) {
        await chrome.tabs.update(tab.id, { url: originalUrl });
      } else {
        restoringTabs.delete(tab.id);
      }
    } catch (error) {
      restoringTabs.delete(tab.id);
      console.warn(`Morning Protection: could not restore tab ${tab.id}`, error);
    }
  }
}

async function scheduleBoundary(config) {
  const boundary = nextBoundaryAt(config);
  if (boundary) {
    await chrome.alarms.create(BOUNDARY_ALARM_NAME, { when: boundary.getTime() });
  } else {
    await chrome.alarms.clear(BOUNDARY_ALARM_NAME);
  }
}

async function syncState() {
  const config = await getConfig();
  const shouldBlock = await replaceRules(config);
  if (shouldBlock) {
    await redirectOpenTabs(config);
  } else {
    // Remove the redirect rules before navigating back, or the restored pages would be blocked again.
    await restoreOpenTabs();
  }
  await scheduleBoundary(config);
  await chrome.action.setTitle({
    title: shouldBlock ? 'Morning Protection：屏蔽中' : 'Morning Protection：可访问',
  });
}

function sync() {
  // Startup, settings changes and page requests can overlap; serialize them to avoid double back navigation.
  syncQueue = syncQueue.then(syncState).then(() => true).catch((error) => {
    console.error('Morning Protection: could not sync protection', error);
    return false;
  });
  return syncQueue;
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME || alarm.name === BOUNDARY_ALARM_NAME) sync();
});

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if ((changes.url && !getBlockedPage(changes.url)) || changes.status === 'complete') {
    restoringTabs.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  restoringTabs.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'restore-blocked-tabs' || !getBlockedPage(sender.url)) return;
  sync().then((ok) => sendResponse({ ok }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  sync();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  sync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') sync();
});

// service worker 每次被唤醒都会执行顶层代码，用它兜住 alarm 丢失或规则与时间脱节的情况
ensureAlarm();
sync();
