const availableEmojis = [];
let emojiOrder = [];

// 처음 팝업이 열릴 때 UI를 렌더링
document.addEventListener("DOMContentLoaded", async () => {
  renderPopupUI();

  dragAndDropEmoticon();

  try {
    // 1. 현재 활성화된 치지직 탭을 찾음
    const tabs = await chrome.tabs.query({
      active: true,
      url: "https://chzzk.naver.com/*",
    });
    if (tabs.length === 0) {
      return;
    }
    const chzzkTab = tabs[0];

    // 2. content.js에 userStatusIdHash를 요청
    const hashResponse = await chrome.tabs.sendMessage(chzzkTab.id, {
      type: "GET_USER_HASH",
    });
    const userStatusIdHash = hashResponse?.userStatusIdHash;

    if (!userStatusIdHash) {
      console.error("Can't get userStatusIdHash.");
      return;
    }

    // 3. 이모티콘 목록과 저장된 순서를 동시에 요청
    const [emoticonDataResponse, storageData] = await Promise.all([
      chrome.runtime.sendMessage({
        type: "GET_EMOJI_PACKS",
        userStatusIdHash: userStatusIdHash,
      }),
      chrome.storage.local.get("emoticonOrder"),
    ]);

    const emoticonOrder = storageData.emoticonOrder;
    emojiOrder = emojiOrder.slice();

    if (emoticonDataResponse?.success) {
      const { emojiPacks, cheatKeyEmojiPacks, subscriptionEmojiPacks } =
        emoticonDataResponse.data;
      // 4. 성공적으로 데이터를 받으면 화면에 리스트를 그림
      [emojiPacks, cheatKeyEmojiPacks, subscriptionEmojiPacks].forEach(
        (packs) => {
          if (packs)
            packs.forEach((pack) => {
              if (!pack.emojiPackLocked)
                availableEmojis.push({
                  id: pack.emojiPackId,
                  name: pack.emojiPackName,
                  imgSrc: pack.emojiPackImageUrl,
                });
            });
        }
      );
      renderEmoticonList(availableEmojis, emoticonOrder);
    } else {
      console.error("Fail to get emoticon list:", emoticonDataResponse?.error);
    }
  } catch (error) {
    // content.js가 아직 주입되지 않았거나 응답이 없는 경우 오류가 발생
    console.error("Occur error while initializing popup:", error);
  }
});

// manifest.json 파일의 정보
const manifest = chrome.runtime.getManifest();
const version = manifest.version;

const versionElement = document.createElement("div");
versionElement.id = "version-display";
versionElement.textContent = `v.${version}`;

document.body.prepend(versionElement);

// 저장된 값을 input에 표시하는 함수
async function loadDisplayMax() {
  const maxInput = document.getElementById("max-count");
  const { chzzkRecentMax = 20 } = await chrome.storage.local.get(
    "chzzkRecentMax"
  );
  maxInput.value = chzzkRecentMax;
}

/**
 * 현재 상태에 맞춰 팝업 UI를 그리고 이벤트 리스너를 설정하는 함수
 */
function renderPopupUI() {
  const reloadBtn = document.getElementById("reload-btn");
  const updateNotice = document.getElementById("update-notice");
  const pauseToggle = document.getElementById("pause-toggle");

  const descriptionOn = document.getElementById("description-on");
  const descriptionOff = document.getElementById("description-off");

  const emoticonEdit = document.querySelector("#emoticon-list-wrapper span");
  const emoticonEditArrow = document.querySelector(
    "#emoticon-list-wrapper svg"
  );
  const emoticonListContainer = document.getElementById(
    "emoticon-list-container"
  );
  const refreshBtn = document.getElementById("refresh-btn");

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

    emoticonEdit.addEventListener("click", async () => {
      // 현재 활성화된 탭 정보를 가져옵니다.
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      // 현재 탭이 치지직인지 확인합니다.
      const isChzzkTab = tab?.url?.startsWith("https://chzzk.naver.com/");
      if (!isChzzkTab) {
        emoticonListContainer.innerHTML =
          '<p class="edit-unavailable-message">치지직 탭에서 편집할 수 있어요!</p>';
      }

      emoticonListContainer.classList.toggle("hidden");
      if (emoticonListContainer.classList.contains("hidden")) {
        emoticonEditArrow.style.transform = "rotate(0deg)";
      } else {
        emoticonEditArrow.style.transform = "rotate(90deg)";
      }
    });

    refreshBtn.addEventListener("click", saveRefreshOrder);
  });

  // --- 최대 개수 UI 바인딩 ---
  const maxInput = document.getElementById("max-count");
  const maxConfirmBtn = document.getElementById("max-count-confirm-btn");

  loadDisplayMax();

  maxInput.oninput = () => {
    const value = maxInput.value;
    const minValue = 15;
    const maxValue = 60;

    const newLimit = parseInt(value, 10);

    if (value.trim() === "") {
      maxConfirmBtn.disabled = true;
      maxInput.classList.add("input-invalid");
      return;
    }

    const isValid =
      !isNaN(newLimit) && newLimit >= minValue && newLimit <= maxValue;
    maxConfirmBtn.disabled = !isValid;
    maxInput.classList.toggle("input-invalid", !isValid);
  };

  maxConfirmBtn.onclick = async () => {
    const minValue = 15;
    const maxValue = 60;
    let value = Math.max(
      minValue,
      Math.min(maxValue, parseInt(maxInput.value, 10) || 20)
    );

    if (!isNaN(value)) {
      await chrome.storage.local.set({ chzzkRecentMax: value });
      maxInput.value = value;
      requestMaxConfirm();
    } else {
      // 유효하지 않은 값이면 저장된 값으로 복원
      loadDisplayMax();
    }
  };
}

/**
 * '최근 이모티콘 최대 개수' 버튼 클릭 시 실행될 함수
 */
function requestMaxConfirm() {
  reloadModal(`최근 이모티콘 개수를 <br>업데이트 합니다.`, 130);
  setTimeout(() => {
    // chrome.runtime.sendMessage({ type: "REQUEST_SOFT_REAPPLY" });
    window.close();
  }, 1000);
}

/**
 * '이모티콘 순서 편집 초기화' 버튼 클릭 시 실행될 함수
 */
function requestRefreshEmoticonOrder() {
  reloadModal(`이모티콘 순서를 <br>초기화 합니다.`, 130);
  setTimeout(() => {
    window.close();
  }, 1000);
}

/**
 * 전달받은 이모티콘 데이터와 저장된 순서로 목록 UI를 생성하는 함수
 * @param {Array} allPacks - 가공된 전체 이모티콘 팩 데이터 배열
 * @param {Array} savedOrder - chrome.storage에서 가져온 ID 순서 배열
 */
function renderEmoticonList(allPacks, savedOrder) {
  const container = document.getElementById("emoticon-list-container");
  container.innerHTML = ""; // 기존 목록 초기화

  let finalPacks = allPacks;

  // 저장된 순서가 유효한 배열일 경우, 목록을 재정렬
  if (savedOrder && Array.isArray(savedOrder) && savedOrder.length > 0) {
    // allPacks를 Map 형태로 변환하여 빠르게 찾을 수 있도록 함
    const packsMap = new Map(allPacks.map((p) => [`emoji_pack_id_${p.id}`, p]));

    const orderedPacks = [];
    const newPacks = [];

    // 1. 저장된 순서(savedOrder)에 따라 orderedPacks 배열을 채움
    savedOrder.forEach((id) => {
      if (packsMap.has(id)) {
        orderedPacks.push(packsMap.get(id));
        packsMap.delete(id); // 처리된 팩은 Map에서 제거
      }
    });

    // 2. packsMap에 남아있는 팩들은 새로 추가된 이모티콘
    // 이들을 newPacks 배열에 추가
    newPacks.push(...packsMap.values());

    // 3. 최종 목록은 [정렬된 팩 + 새로 추가된 팩] 순서
    finalPacks = [...orderedPacks, ...newPacks];
  }

  // 최종적으로 정렬된 finalPacks 배열을 기반으로 HTML 요소를 만들어 추가
  finalPacks.forEach((pack) => {
    const item = document.createElement("div");
    item.className = "emoticon-item";
    item.draggable = true;
    item.dataset.id = pack.id;
    item.innerHTML = `
            <span class="drag-handle">☰</span>
            <img src="${pack.imgSrc}" class="emoticon-img" alt="${pack.name}" draggable="false">
            <span class="emoticon-name">${pack.name}</span>
        `;
    container.appendChild(item);
  });
}

function dragAndDropEmoticon() {
  const container = document.getElementById("emoticon-list-container");
  let draggedItem = null; // 현재 드래그 중인 아이템을 저장할 변수

  // 드래그 시작 이벤트
  container.addEventListener("dragstart", (e) => {
    draggedItem = e.target;
    // 드래그 중인 아이템에 시각적 효과를 주기 위한 클래스 추가
    setTimeout(() => e.target.classList.add("dragging"), 0);
    document.body.classList.add("grabbing");
  });

  // 드래그 아이템이 다른 아이템 위로 지나갈 때 이벤트
  container.addEventListener("dragover", (e) => {
    e.preventDefault(); // drop 이벤트를 허용하기 위해 필수

    // '복사'가 아닌 '이동' 작업임을 브라우저에 명시합니다.
    e.dataTransfer.dropEffect = "move";

    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedItem);
    } else {
      container.insertBefore(draggedItem, afterElement);
    }
  });

  // 드래그 종료 이벤트 (드롭 성공 여부와 관계없이 발생)
  container.addEventListener("dragend", (e) => {
    // 시각적 효과 클래스 제거
    e.target.classList.remove("dragging");
    saveOrder();
    document.body.classList.remove("grabbing");
  });

  // 드래그 중인 아이템이 어느 요소의 바로 뒤에 와야 하는지 계산하는 함수
  function getDragAfterElement(container, y) {
    const draggableElements = [
      ...container.querySelectorAll(".emoticon-item:not(.dragging)"),
    ];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  }

  // 변경된 순서를 chrome.storage에 저장하는 함수
  function saveOrder() {
    const newOrder = [];
    const items = container.querySelectorAll(".emoticon-item");
    items.forEach((item) => {
      // 각 아이템의 data-id를 순서대로 배열에 추가
      newOrder.push(`emoji_pack_id_${item.dataset.id}`);
    });

    // 새로운 순서 배열을 저장
    chrome.storage.local.set({ emoticonOrder: newOrder });
  }
}

function saveRefreshOrder() {
  const newOrder = [];
  availableEmojis.forEach((item) => {
    // 각 아이템의 data-id를 순서대로 배열에 추가
    newOrder.push(`${item.id}`);
  });

  // 새로운 순서 배열을 저장
  chrome.storage.local.set({ emoticonOrder: newOrder }, () => {});
  renderEmoticonList(availableEmojis, emojiOrder);
  requestRefreshEmoticonOrder();
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

  setTimeout(() => {
    chrome.storage.local.set({ updateNeeded: false });
    // 2. 백그라운드에 '소프트 재적용'을 요청
    chrome.runtime.sendMessage({ type: "REQUEST_SOFT_REAPPLY" });

    // 3. 백그라운드에 '배지 제거'를 요청
    chrome.runtime.sendMessage({ type: "CLEAR_UPDATE_BADGE" });
    window.close();
  }, 1000);
}

/**
 * '확장 프로그램 새로고침' 버튼 클릭 시 실행될 함수
 */
function requestExtensionReload() {
  reloadModal(`치모티콘 정리를 <br>재실행 합니다.`, 130);
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "MANUAL_RELOAD_REQUEST" });
    window.close();
  }, 1000);
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

  // 1초 후에 '사라지는' 애니메이션 시작
  setTimeout(() => {
    reloadModalContentText.style.transform = "";
  }, 500);
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

  const modalInnetText =
    actionText === "OFF"
      ? `기능을 ${actionText}하려면 열려있는 모든 치지직 페이지를 새로고침해야 합니다.\n\n계속 진행하시겠습니까?`
      : `치모티콘 정리를 ${actionText}하시겠습니까?`;

  modalContents.style.height = `${window.innerHeight - 20}px`;
  // 모달 내용 설정
  modalContentText.innerText = modalInnetText;

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
      chrome.runtime.sendMessage({ type: "CLEAR_UPDATE_BADGE" });
    }

    chrome.storage.local.set(
      { isPaused: isPaused, updateNeeded: false },
      () => {
        if (isPaused) {
          // 0ff - 페이지 새로고침
          setTimeout(() => {
            chrome.tabs.query({ url: "https://chzzk.naver.com/*" }, (tabs) => {
              tabs.forEach((tab) => chrome.tabs.reload(tab.id));
            });
            window.close();
          }, 550);
        } else {
          // on - soft 재주입
          setTimeout(() => {
            chrome.runtime.sendMessage({ type: "REQUEST_SOFT_REAPPLY" });
            window.close();
          }, 550);
        }
        // 팝업 UI 재렌더링
        renderPopupUI();
      }
    );
  });
}
