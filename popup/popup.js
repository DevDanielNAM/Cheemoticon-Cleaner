// 처음 팝업이 열릴 때 UI를 렌더링
document.addEventListener("DOMContentLoaded", () => {
  renderPopupUI();
});

/**
 * 현재 상태에 맞춰 팝업 UI를 그리고 이벤트 리스너를 설정하는 함수
 */
function renderPopupUI() {
  // manifest.json 파일의 정보
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version;

  const versionElement = document.createElement("div");
  versionElement.id = "version-display";
  versionElement.textContent = `v${version}`;

  document.body.prepend(versionElement);

  const reloadBtn = document.getElementById("reload-btn");
  const updateNotice = document.getElementById("update-notice");
  const pauseToggle = document.getElementById("pause-toggle");

  const descriptionOn = document.getElementById("description-on");
  const descriptionOff = document.getElementById("description-off");

  // 기존에 설정된 이벤트 리스너가 중복으로 쌓이지 않도록 초기화
  // .cloneNode(true)는 엘리먼트를 복제하는 간단한 방법으로, 모든 이벤트 리스너를 제거
  const newReloadBtn = reloadBtn.cloneNode(true);
  reloadBtn.parentNode.replaceChild(newReloadBtn, reloadBtn);

  const newPauseToggle = pauseToggle.cloneNode(true);
  pauseToggle.parentNode.replaceChild(newPauseToggle, pauseToggle);

  // --- 1. 'updateNeeded'와 'isPaused' 상태를 동시에 확인 ---
  chrome.storage.local.get(["updateNeeded", "isPaused"], (data) => {
    const isPaused = data.isPaused === undefined ? false : data.isPaused;
    // --- 2. 일시정지 토글 스위치의 현재 상태를 먼저 설정 ---
    newPauseToggle.checked = !isPaused;

    descriptionOn.classList.toggle("translate-x-on", isPaused);
    descriptionOff.classList.toggle("translate-x-off", isPaused);

    // --- 3. 업데이트 필요 여부에 따라 버튼의 모양과 기능을 결정 ---
    if (data.updateNeeded) {
      // 업데이트가 필요한 경우
      updateNotice.style.display = "block";
      newReloadBtn.querySelector("#reload-icon").style.display = "none";
      newReloadBtn.querySelector("#update-icon").style.display = "block";
      newReloadBtn.title = "'치모티콘 정리' 업데이트";

      newReloadBtn.addEventListener("click", applyUpdateAndReloadTabs);
      updateNotice.addEventListener("click", applyUpdateAndReloadTabs);
    } else {
      // 평상시
      updateNotice.style.display = "none";
      newReloadBtn.querySelector("#reload-icon").style.display = "block";
      newReloadBtn.querySelector("#update-icon").style.display = "none";
      newReloadBtn.title = "'치모티콘 정리' 재실행";

      newReloadBtn.addEventListener("click", requestExtensionReload);
    }

    // --- 4. 일시정지 토글의 'change' 이벤트 리스너를 설정 ---
    newPauseToggle.addEventListener("change", handlePauseToggle);
  });
}

/**
 * '업데이트 적용' 버튼 클릭 시 실행될 함수
 */
function applyUpdateAndReloadTabs() {
  chrome.storage.local.get("isPaused", (data) => {
    if (data.isPaused) {
      chrome.storage.local.set({ isPaused: false });
    }
  });
  // 열려있는 모든 치지직 탭을 새로고침
  chrome.tabs.query({ url: "*://*.chzzk.naver.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.reload(tab.id);
    });
  });
  // 상태 플래그를 false로 되돌리고, 배지 제거 메시지를 보냄
  chrome.storage.local.set({ updateNeeded: false });
  chrome.runtime.sendMessage({ type: "NEW_VERSION_LOADED" });
  window.close();
}

/**
 * '확장 프로그램 새로고침' 버튼 클릭 시 실행될 함수
 */
function requestExtensionReload() {
  chrome.runtime.sendMessage({ type: "MANUAL_RELOAD_REQUEST" });
  window.close();
}

/**
 * '일시정지' 토글 스위치 상태 변경 시 실행될 함수
 */
function handlePauseToggle(event) {
  const isPaused = !event.target.checked;
  const actionText = isPaused ? "OFF" : "ON";

  const userConfirmed = confirm(
    `기능을 ${actionText}하려면 열려있는 모든 치지직 페이지를 새로고침해야 합니다.\n\n계속 진행하시겠습니까?`
  );

  // 사용자가 "확인" 버튼을 눌렀을 경우에만 (true일 때) 아래 로직을 실행
  if (userConfirmed) {
    chrome.storage.local.get("updateNeeded", (data) => {
      // 만약 업데이트가 필요한 상태에서 토글을 누른다면,
      // 페이지가 새로고침되면서 업데이트가 적용되므로 'updateNeeded' 상태를 해제
      if (data.updateNeeded) {
        chrome.runtime.sendMessage({ type: "NEW_VERSION_LOADED" });
      }

      chrome.storage.local.set(
        { isPaused: isPaused, updateNeeded: false },
        () => {
          // 치지직 탭을 새로고침하여 '일시정지/활성화' 상태를 즉시 적용
          chrome.tabs.query({ url: "*://*.chzzk.naver.com/*" }, (tabs) => {
            tabs.forEach((tab) => chrome.tabs.reload(tab.id));
          });

          // 상태 변경 후, 팝업 UI를 즉시 다시 렌더링
          renderPopupUI();
        }
      );
    });
  } else {
    // 사용자가 "취소" 버튼을 누른 경우, 토글 스위치를 원래 상태로
    event.target.checked = !event.target.checked;
  }
}
