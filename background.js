/**
 * 치지직 탭을 새로고침하는 함수
 */
function reloadChzzkTabs() {
  const targetUrl = "https://chzzk.naver.com/*";
  chrome.tabs.query({ url: targetUrl }, (tabs) => {
    if (tabs.length > 0) {
      tabs.forEach((tab) => {
        chrome.tabs.reload(tab.id, { bypassCache: true }); // 캐시를 우회하여 확실하게 새로고침
      });
    }
  });
}

async function reloadChzzkTabsAsync() {
  const targetUrl = "https://chzzk.naver.com/*";
  try {
    const tabs = await chrome.tabs.query({ url: targetUrl });
    if (tabs.length > 0) {
      // 모든 탭에 새로고침 명령을 보내고, 모든 명령이 성공적으로 전달될 때까지 기다림
      const reloadPromises = tabs.map((tab) =>
        chrome.tabs.reload(tab.id, { bypassCache: true })
      );
      await Promise.all(reloadPromises);
    }
  } catch (error) {
    console.error("Error reload tabs:", error);
  }
}

/**
 * 페이지 리로드 없이 content/style만 재주입(소프트 재적용)
 */
async function softReapplyToChzzkTabs() {
  const targetUrl = "https://chzzk.naver.com/*";
  const tabs = await new Promise((resolve) =>
    chrome.tabs.query({ url: targetUrl }, resolve)
  );

  const version = Date.now();

  for (const tab of tabs) {
    try {
      // 1) CSS는 그대로
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["style.css"],
      });

      // 2) content 살아있는지 확인
      let alive = false;
      try {
        const pong = await chrome.tabs.sendMessage(tab.id, {
          type: "CHEEMO_PING",
        });
        alive = !!pong?.alive;
      } catch (_) {
        alive = false;
      }

      // 3) 없으면 content.js를 '한 번만' 주입
      if (!alive) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
        } catch (_) {
          // 특수 페이지면 그냥 리로드
          chrome.tabs.reload(tab.id, { bypassCache: true });
          continue;
        }
      }

      // 4) inject.js 강제 재주입 + 기능 ON
      await chrome.tabs.sendMessage(tab.id, {
        type: "CHEEMO_REINJECT",
        version,
      });
      await chrome.tabs.sendMessage(tab.id, { type: "CHEEMO_ENABLE" });
    } catch (_) {
      // 스타일 주입 실패 등 특수 페이지면 그냥 리로드
      chrome.tabs.reload(tab.id, { bypassCache: true });
    }
  }
}

/**
 * 메시지 수신 리스너
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_EMOJI_PACKS") {
    const { userStatusIdHash } = request;
    if (!userStatusIdHash) {
      sendResponse({ success: false, error: "userStatusIdHash is missing" });
      return;
    }

    (async () => {
      try {
        const cacheKey = `emoji_cache_${userStatusIdHash}`;
        const expiryKey = `emoji_expiry_${userStatusIdHash}`;

        // 1. 로컬 스토리지에서 캐시와 만료 시간을 가져옴
        const { [cacheKey]: cachedData, [expiryKey]: expiryTimestamp } =
          await chrome.storage.local.get([cacheKey, expiryKey]);

        // 2. 캐시가 유효한지 확인 (캐시가 존재하고, 만료 시간이 지나지 않았을 경우)
        // request.forceRefresh 플래그가 없는 경우에만 캐시를 사용
        const useCache =
          !request.forceRefresh &&
          cachedData &&
          expiryTimestamp &&
          Date.now() < expiryTimestamp;

        if (useCache) {
          // 캐시가 유효하면 캐시된 데이터를 즉시 반환
          sendResponse({ success: true, data: cachedData, fromCache: true });
          return;
        }

        // 3. 캐시가 없거나 만료된 경우, API를 호출하여 새로운 데이터를 가져옴
        // 두 API를 병렬로 호출하여 성능을 최적화
        const [emojiPacksResponse, subscriptionResponse] = await Promise.all([
          fetch(
            `https://api.chzzk.naver.com/service/v1/channels/${userStatusIdHash}/emoji-packs`
          ),
          fetch("https://api.chzzk.naver.com/commercial/v1/subscribe/channels"),
        ]);

        if (!emojiPacksResponse.ok) {
          throw new Error(
            `Emoji Packs API call failed with status: ${emojiPacksResponse.status}`
          );
        }

        const emojiData = await emojiPacksResponse.json();
        const emojiContent = emojiData.content;

        let earliestExpiry = Infinity;
        // 구독 정보 API 호출이 성공했을 때만 만료 시간 계산
        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json();
          const subscriptions = subscriptionData.content || [];

          const expiryDates = subscriptions
            .map((sub) => sub.nextPublishYmdt)
            .filter(Boolean) // null이나 undefined 된 값 제외
            .map((dateStr) => new Date(dateStr).getTime()); // 날짜 문자열을 타임스탬프로 변환

          if (expiryDates.length > 0) {
            earliestExpiry = Math.min(...expiryDates);
          }
        }

        // 4. 새로운 만료 시간을 설정
        // 구독 정보에서 가장 빠른 만료 시간을 사용하되,
        // 구독이 없거나 날짜 정보가 없는 경우 기본값으로 24시간 후로 설정
        const nextExpiry = isFinite(earliestExpiry)
          ? earliestExpiry
          : Date.now() + 24 * 60 * 60 * 1000; // 24시간

        // 5. 새로운 데이터와 만료 시간을 스토리지에 저장
        await chrome.storage.local.set({
          [cacheKey]: emojiContent,
          [expiryKey]: nextExpiry,
        });

        // 가져온 새 데이터를 클라이언트에게 전송
        sendResponse({ success: true, data: emojiContent, fromCache: false });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // sendResponse를 비동기적으로 사용하기 위해 true를 반환
  }

  if (request.type === "MANUAL_RELOAD_REQUEST") {
    // 비동기 함수로 감싸서 await을 사용
    (async () => {
      // 1. 탭 새로고침이 완료될 때까지 기다림
      await reloadChzzkTabsAsync();

      // 2. 탭 새로고침이 끝난 후, 확장 프로그램을 재실행
      chrome.storage.local.set({ isManualReload: true }).then(() => {
        chrome.runtime.reload();
      });
    })();

    return true;
  }

  // '업데이트 적용' 또는 'ON' 시 소프트 재주입을 요청하는 메시지
  if (request.type === "REQUEST_SOFT_REAPPLY") {
    softReapplyToChzzkTabs();
    return true;
  }

  // 기존 NEW_VERSION_LOADED는 배지 제거 역할만 하도록 분리
  if (request.type === "CLEAR_UPDATE_BADGE") {
    chrome.action.setBadgeText({ text: "" });
    return;
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
