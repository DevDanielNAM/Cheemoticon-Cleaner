// 처음 팝업이 열릴 때 UI를 렌더링
document.addEventListener("DOMContentLoaded", () => {
  renderPopupUI();
});

// manifest.json 파일의 정보
const manifest = chrome.runtime.getManifest();
const version = manifest.version;

const versionElement = document.createElement("div");
versionElement.id = "version-display";
versionElement.textContent = `v.${version}`;

document.body.prepend(versionElement);

/**
 * 현재 상태에 맞춰 팝업 UI를 그리고 이벤트 리스너를 설정하는 함수
 */
function renderPopupUI() {
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
  reloadModal(`치모티콘 정리를 <br>업데이트 합니다.`, 140);
  // 열려있는 모든 치지직 탭을 새로고침
  chrome.tabs.query({ url: "*://*.chzzk.naver.com/*" }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.reload(tab.id);
    });
  });
  setTimeout(() => {
    chrome.storage.local.set({ updateNeeded: false });
    chrome.runtime.sendMessage({ type: "NEW_VERSION_LOADED" });
    window.close();
  }, 2400);
}

/**
 * '확장 프로그램 새로고침' 버튼 클릭 시 실행될 함수
 */
function requestExtensionReload() {
  reloadModal(`치모티콘 정리를 <br>재실행 합니다.`, 130);
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "MANUAL_RELOAD_REQUEST" });
    window.close();
  }, 2400);
}

function reloadModal(msg, posY) {
  const reloadModalWrapper = document.getElementById("reload-modal-wrapper");
  const reloadModalContentText = document.getElementById(
    "reload-modal-content-text"
  );

  reloadModalWrapper.style.display = "flex";
  reloadModalContentText.innerHTML = msg;

  // // 한 프레임 뒤에 transform 클래스를 추가하여 '나타나는' 애니메이션을 보장
  requestAnimationFrame(() => {
    reloadModalContentText.style.transform = `translateY(${posY}px)`;
  });

  // 2초 후에 '사라지는' 애니메이션 시작
  setTimeout(() => {
    reloadModalContentText.style.transform = "";
  }, 2000);
}

/**
 * '일시정지' 토글 스위치 상태 변경 시 모달을 띄우는 함수
 * @param {Event} event - 토글 스위치의 change 이벤트 객체
 */
function handlePauseToggle(event) {
  const isPaused = !event.target.checked;
  const actionText = isPaused ? "OFF" : "ON";

  const modalWrapper = document.getElementById("modal-wrapper");
  const modalContents = document.getElementById("modal-contents");
  const modalContentText = document.getElementById("modal-content-text");
  const modalCancelButton = document.querySelector(".modal-cancel-button");
  const modalConfirmButton = document.querySelector(".modal-confirm-button");

  modalContents.style.height = `${window.innerHeight - 20}px`;
  // 모달 내용 설정
  modalContentText.innerText = `기능을 ${actionText}하려면 열려있는 모든 치지직 페이지를 새로고침해야 합니다.\n\n계속 진행하시겠습니까?`;

  // 모달을 화면에 표시
  modalWrapper.style.display = "block";

  // .onclick을 사용하여 이벤트 리스너가 중복되지 않도록 함

  // 확인 버튼 클릭 시
  modalConfirmButton.onclick = () => {
    // 모달을 먼저 숨김
    modalWrapper.style.display = "none";

    // 실제 기능 실행
    applyPauseToggle(isPaused);
  };

  // 취소 버튼 클릭 시
  modalCancelButton.onclick = () => {
    // 모달을 숨김
    modalWrapper.style.display = "none";

    // 토글 스위치를 원래 상태로 되돌림
    event.target.checked = !event.target.checked;
  };
}

/**
 * 모달의 '확인'을 눌렀을 때 실제 토글 기능을 적용하는 함수
 * @param {boolean} isPaused - 일시정지 여부
 */
function applyPauseToggle(isPaused) {
  chrome.storage.local.get("updateNeeded", (data) => {
    // 업데이트가 필요한 상태에서 토글하면, 업데이트 상태도 함께 해제
    if (data.updateNeeded) {
      chrome.runtime.sendMessage({ type: "NEW_VERSION_LOADED" });
    }

    chrome.storage.local.set(
      { isPaused: isPaused, updateNeeded: false },
      () => {
        // 치지직 탭 새로고침
        chrome.tabs.query({ url: "*://*.chzzk.naver.com/*" }, (tabs) => {
          tabs.forEach((tab) => chrome.tabs.reload(tab.id));
        });

        // 팝업 UI 재렌더링
        renderPopupUI();
      }
    );
  });
}
