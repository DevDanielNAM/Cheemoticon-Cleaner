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
 * 페이지 리로드 없이 content/style만 재주입(소프트 재적용)
 */
async function softReapplyToChzzkTabs() {
  const targetUrl = "*://*.chzzk.naver.com/*";
  const tabs = await new Promise((resolve) =>
    chrome.tabs.query({ url: targetUrl }, resolve)
  );

  for (const tab of tabs) {
    try {
      // 스크립팅 권한이 없을 수 있는 페이지(예: 오류 페이지)를 위해 예외 처리
      await chrome.scripting
        .unregisterContentScripts({ ids: [`content-script-${tab.id}`] })
        .catch(() => {});
      await chrome.scripting.registerContentScripts([
        {
          id: `content-script-${tab.id}`,
          js: ["content.js"],
          css: ["style.css"],
          matches: ["*://*.chzzk.naver.com/*"],
          runAt: "document_idle",
        },
      ]);
      // 즉시 실행을 위해 executeScript를 사용
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (_) {
      chrome.tabs.reload(tab.id, { bypassCache: true });
    }
  }
}

/**
 * 메시지 수신 리스너
 */
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  if (request.type === "MANUAL_RELOAD_REQUEST") {
    // 재실행 요청을 받으면, 페이지 새로고침을 먼저 예약하고 확장 프로그램을 재시작
    reloadChzzkTabs();

    // 짧은 지연 후 확장 프로그램 재실행
    setTimeout(() => {
      chrome.storage.local.set({ isManualReload: true }).then(() => {
        chrome.runtime.reload();
      });
    }, 150);
    return;
  }

  // '업데이트 적용' 또는 'ON' 시 소프트 재주입을 요청하는 메시지
  if (request.type === "REQUEST_SOFT_REAPPLY") {
    softReapplyToChzzkTabs();
    return true;
  }

  // 기존 NEW_VERSION_LOADED는 배지 제거 역할만 하도록 분리
  if (request.type === "CLEAR_UPDATE_BADGE") {
    chrome.action.setBadgeText({ text: "" });
  }
});

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
  softReapplyToChzzkTabs();
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
