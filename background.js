/**
 * 치지직 탭을 새로고침하는 함수
 */
function reloadChzzkTabs() {
  const targetUrl = "*://*.chzzk.naver.com/*";
  chrome.tabs.query({ url: targetUrl }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach((tab) => {
        chrome.tabs.reload(tab.id, { bypassCache: true }); // 캐시를 우회하여 확실하게 새로고침
      });
    }
  });
}

/**
 * 1. 설치 또는 업데이트 시 실행
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  const { isManualReload } = await chrome.storage.local.get("isManualReload");

  // 플래그가 있다면, 이것은 수동 새로고침이므로 아무것도 하지 않음
  if (isManualReload) {
    // 확인 후 반드시 플래그를 제거하여 다음 업데이트에 영향을 주지 않도록 함
    await chrome.storage.local.remove("isManualReload");
    return;
  }

  // 처음 설치 시 자동 새로고침
  if (details.reason === "install") {
    reloadChzzkTabs();
  }

  // 업데이트 시에는 배지만 표시하고, 임시 플래그를 설정
  if (details.reason === "update") {
    chrome.action.setBadgeText({ text: "🔔" });
    chrome.action.setBadgeBackgroundColor({ color: "#ff1d1da5" });
    chrome.storage.local.set({ updateNeeded: true });
    // '업데이트' 직후라는 표시를 남김
    await chrome.storage.session.set({ justUpdated: true });
  }
});

/**
 * 2. 브라우저 시작 시 실행
 */
chrome.runtime.onStartup.addListener(() => {
  reloadChzzkTabs();
});

/**
 * 3. 확장 프로그램이 '활성화'될 때 실행 (수동 토글 또는 업데이트 후)
 */
chrome.management.onEnabled.addListener(async (extensionInfo) => {
  // 현재 확장 프로그램 자신일 때만 실행
  if (extensionInfo.id === chrome.runtime.id) {
    const { justUpdated } = await chrome.storage.session.get("justUpdated");
    chrome.storage.local.set({ isPaused: false });

    if (justUpdated) {
      // '업데이트' 플래그가 있으면, 새로고침 없이 플래그만 제거
      await chrome.storage.session.remove("justUpdated");
    } else {
      // 플래그가 없으면 '수동 활성화'로 간주하고 새로고침 실행
      reloadChzzkTabs();
    }
  }
});

/**
 * 4. content.js로부터 메시지를 받으면 배지를 제거
 */
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.type === "NEW_VERSION_LOADED") {
    chrome.action.setBadgeText({ text: "" });
  }

  if (request.type === "MANUAL_RELOAD_REQUEST") {
    chrome.storage.local.set({ isManualReload: true }).then(() => {
      // 저장이 완료된 후 새로고침을 실행
      chrome.runtime.reload();
    });
    return true;
  }
});
