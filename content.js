// 전역 window 객체에 현재 스크립트의 실행 여부를 기록
if (window.myEmoticonExtensionInstance) {
  // 이전 버전의 Observer 등을 정리하는 함수를 호출
  window.myEmoticonExtensionInstance.cleanup();
}

// 확장 프로그램 기능 시작 전, 일시정지 상태인지 확인
chrome.storage.local.get("isPaused", (data) => {
  if (data.isPaused) {
    return; // isPaused가 true이면, 아래 모든 코드 실행을 중단
  }
  /**
   * 확장 프로그램의 메인 클래스
   * 모든 기능을 캡슐화하고 상태를 관리
   */
  class EmoticonExtension {
    constructor() {
      this.observers = new Map();
      this.isResizing = false;
      this.currentMax = null;
      this.init();
    }

    // Observer 등을 모두 중지시키는 정리(cleanup) 메서드
    cleanup() {
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
      document.removeEventListener("keydown", this.handleEmoticonShortcut);
      document.removeEventListener("keydown", this.handleEscapeKey);
      document.removeEventListener("keydown", this.handleInputShortcut);
    }

    /**
     * 확장 프로그램 초기화: DOM 변경 시마다 기능 적용을 시도
     */
    init() {
      // *** this 바인딩 추가 ***
      // 이벤트 리스너에서 this가 EmoticonExtension 인스턴스를 가리키도록 바인딩
      this.handleEmoticonShortcut = this.handleEmoticonShortcut.bind(this);
      this.handleEscapeKey = this.handleEscapeKey.bind(this);
      this.handleInputShortcut = this.handleInputShortcut.bind(this);
      this.injectAndCommunicate();

      const mainObserver = new MutationObserver(() => {
        // DOM에 어떤 변화든 감지되면, 무조건 기능 적용 함수를 호출
        this.applyRecentEmoticonFeatures();
        this.applyShortcutTooltip();
        this.updateInputPlaceholder();
      });

      this.observers.set("main", mainObserver);
      mainObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // 초기 로드 시에도 한 번 실행
      this.applyRecentEmoticonFeatures();

      // 리사이즈 핸들러 초기화
      this.initializeResizeHandler();

      this.updateInputPlaceholder();

      // 키보드 단축키 이벤트 리스너를 등록
      document.addEventListener("keydown", this.handleEmoticonShortcut);
      document.addEventListener("keydown", this.handleEscapeKey);
      document.addEventListener("keydown", this.handleInputShortcut);
    }

    /**
     * inject.js를 웹 페이지에 주입하고, 저장된 최대 개수 설정을 전달하는 함수
     */
    async injectAndCommunicate() {
      await this.injectScript("inject.js");

      // storage에서 설정 값을 가져와 inject.js로 전송
      const { chzzkRecentMax = 20 } = await chrome.storage.local.get(
        "chzzkRecentMax"
      );
      this.postMaxCountToPage(chzzkRecentMax);
      this.currentMax = chzzkRecentMax;
      // storage 값이 변경될 때마다 inject.js에 다시 알려주기 위한 리스너
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === "local" && changes.chzzkRecentMax) {
          const newMax = changes.chzzkRecentMax.newValue;

          // 1. inject.js와 통신
          this.postMaxCountToPage(changes.chzzkRecentMax.newValue);

          // 2. 현재 클래스 인스턴스의 최대값 상태를 업데이트
          this.currentMax = newMax;

          // 3. UI를 다시 렌더링하여 제목을 실시간으로 변경
          const container = document.getElementById("recent_emoticon");
          if (container) {
            this.applyUiSettings(container);
          }
        }
      });
    }

    /**
     * 지정된 스크립트 파일을 페이지의 DOM에 삽입하는 유틸리티 함수
     * @param {string} filePath - 확장 프로그램 루트 기준 파일 경로
     */
    injectScript(filePath) {
      return new Promise((resolve) => {
        // window 객체에 우리만의 플래그를 확인하여, 이미 주입되었다면 다시 실행하지 않음
        if (window.cheemoticonInjected) {
          resolve();
          return;
        }

        const s = document.createElement("script");
        s.src = chrome.runtime.getURL(filePath);
        // 스크립트 로드가 끝나면 DOM에서 제거하여 흔적을 남기지 않음
        s.onload = () => {
          s.remove();
          // 주입에 성공했으면, 다음을 위해 플래그를 남김
          window.cheemoticonInjected = true;
          resolve();
        };
        (document.head || document.documentElement).appendChild(s);
      });
    }
    /**
     * content script에서 페이지의 window 객체로 메시지를 보내는 함수 (inject.js와 통신용)
     * @param {number} maxCount - 전달할 최대 이모티콘 개수
     */
    postMaxCountToPage(maxCount) {
      window.postMessage(
        {
          type: "CHZZK_EMOTICON_MAX_COUNT_UPDATE",
          maxCount: maxCount,
        },
        "*"
      );
    }

    /**
     * 저장된 순서에 따라 이모티콘 카테고리 순서를 재정렬하는 함수
     */
    async reorderEmoticonCategories() {
      // 1. 이모티콘들을 담고 있는 부모 컨테이너를 찾음
      const container = document.querySelector(".flicking-camera");
      if (!container) {
        console.error(
          "[치모티콘 정리] Can't find '.flicking-camera' container."
        );
        return;
      }

      // 이미 순서 변경이 완료되었다는 깃발(data-reordered)이 있으면,
      // 함수를 즉시 종료하여 무한 루프를 방지
      if (container.dataset.reordered === "true") {
        return;
      }

      // 순서를 변경할 대상 아이템(id를 가진 버튼)들이 실제로 DOM에 존재하는지 확인
      const itemsToReorder = container.querySelectorAll(
        "[class*='emoticon_flicking_item__'] button[id]"
      );
      if (itemsToReorder.length === 0) {
        // 아직 이모티콘 팩 아이템들이 렌더링되지 않았으므로,
        // '완료' 깃발을 세우지 않고 함수를 종료하여 다음 실행 기회를 기다림
        return;
      }

      // 2. 저장된 이모티콘 순서 데이터를 가져옴
      const data = await chrome.storage.local.get("emoticonOrder");
      const desiredIdOrder = data.emoticonOrder;

      // 저장된 순서가 없으면 함수를 종료
      if (!desiredIdOrder || !Array.isArray(desiredIdOrder)) {
        return;
      }

      // 3. 현재 페이지에 있는 모든 이모티콘 아이템들을 효율적으로 찾기 위해 Map으로 만듦
      // Key: 버튼 ID, Value: 상위 div 요소 (emoticon_flicking_item__YElNj)
      const itemMap = new Map();
      container
        .querySelectorAll("[class*='emoticon_flicking_item__']")
        .forEach((itemDiv) => {
          const button = itemDiv.querySelector("button[id]");
          if (button) {
            itemMap.set(button.id, itemDiv);
          }
        });

      // 4. 저장된 ID 순서(desiredIdOrder)에 따라 이모티콘 아이템을 컨테이너에 다시 append
      // appendChild는 기존에 있던 요소를 맨 뒤로 '이동'
      desiredIdOrder
        .filter((buttonId) => itemMap.has(buttonId))
        .forEach((buttonId) => {
          const itemToMove = itemMap.get(buttonId);
          if (itemToMove) {
            // 부모 컨테이너에 다시 추가하여 순서를 변경 (맨 뒤로 이동)
            container.appendChild(itemToMove);
          }
        });

      // 모든 작업이 끝난 후, 컨테이너에 깃발을 세워 다음 호출 시에는
      // 작업이 실행되지 않도록 함
      container.dataset.reordered = "true";
    }

    /**
     * UI 관련 모든 설정을 적용하는 함수. 여러 번 호출해도 안전
     * @param {HTMLElement} container - #recent_emoticon element
     */
    applyUiSettings(container) {
      // 1. 전체 삭제 버튼과 wrapper 설정
      const titleElement = container.querySelector("strong");
      if (!titleElement) {
        return; // titleElement가 없으면 함수 종료
      }

      // 현재 이모티콘 개수와 최대 개수 가져오기
      const emoticonList = container.querySelector("ul");
      const currentCount = emoticonList
        ? emoticonList.querySelectorAll("li").length
        : 0;

      // (최초 1회 실행) wrapper가 없으면 생성하고 버튼을 추가
      if (
        !titleElement.parentNode.classList.contains("emoticon-subtitle-wrapper")
      ) {
        const titleWrapper = document.createElement("div");
        titleWrapper.className = "emoticon-subtitle-wrapper";
        titleElement.parentNode.insertBefore(titleWrapper, titleElement);
        titleWrapper.appendChild(titleElement);
        const clearAllButton = this.createClearAllButton();
        titleWrapper.appendChild(clearAllButton);
      }

      // (매번 실행) 제목 텍스트에 최신 개수를 업데이트
      const newTitleText = `최근 사용한 이모티콘 (${currentCount}/${
        this.currentMax !== null ? this.currentMax : "..."
      }개)`;

      // 현재 DOM의 내용과 새로 설정할 내용이 다를 때만 업데이트하여
      // 불필요한 DOM 수정을 막고, 무한 루프를 차단
      if (titleElement.textContent !== newTitleText) {
        titleElement.textContent = newTitleText;
      }

      this.reorderEmoticonCategories();

      // 2. 개별 삭제 버튼 설정 (UI 동기화 포함)
      this.setupEmoticonDeleter(container);

      // 3. 테마에 따른 스타일 업데이트
      this.updateDeleteButtonStyles();

      // 4. '이모티콘 없음' 메시지 상태 업데이트
      this.updateEmptyMessageStatus();
    }

    /**
     * 기능 적용의 시작점
     */
    applyRecentEmoticonFeatures() {
      // *** 컨텍스트 유효성 검사 ***
      // 스크립트가 유효한 확장 프로그램 컨텍스트에서 실행되는지 확인
      // '고아' 스크립트인 경우, 오류를 발생시키기 전에 여기서 실행을 중단
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      const container = document.getElementById("recent_emoticon");
      if (!container) {
        return;
      }

      // '리사이즈 중'이 아닐 때만 저장된 높이를 적용하도록 수정
      if (!this.isResizing) {
        const popupContainer = container.closest(
          '#aside-chatting [class*="popup_container"]'
        );
        if (popupContainer) {
          // 저장된 높이를 적용하기 직전에 부드러운 효과를 활성화
          popupContainer.classList.add("smooth-transition");

          chrome.storage.local.get(["chzzkEmoticonPopupHeight"], (result) => {
            if (result.chzzkEmoticonPopupHeight) {
              popupContainer.style.height = `${result.chzzkEmoticonPopupHeight}px`;
            }
          });
        }
      }

      // 먼저 UI를 즉시 적용하여 깜빡임을 방지
      this.applyUiSettings(container);

      // 그 다음, 백그라운드에서 만료된 이모티콘을 확인하고 UI를 다시 한번 보정
      this.checkAndCorrectExpiredEmoticons(container);
    }

    /**
     * 백그라운드에서 만료된 이모티콘을 확인하고, 변경이 있다면 UI를 다시 한번 전체적으로 적용
     * @param {HTMLElement} container - #recent_emoticon element
     */
    async checkAndCorrectExpiredEmoticons(container) {
      const hasChanged = await this.removeExpiredEmoticonsFromStorage();

      // localStorage에 변경이 있었던 경우 (만료된 이모티콘이 제거된 경우),
      // 웹페이지 스크립트에 의해 UI가 깨졌을 가능성을 대비해 UI 설정을 다시 한번 전체 적용
      if (hasChanged) {
        this.applyUiSettings(container);
      }
    }

    /**
     * API를 통해 만료된 이모티콘을 확인하고 localStorage에서 제거하는 로직
     * @returns {Promise<boolean>} 변경이 있었는지 여부를 반환
     */
    async removeExpiredEmoticonsFromStorage() {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        return false;
      }

      const userStatusIdHash = localStorage.getItem("userStatus.idhash");
      if (!userStatusIdHash) return false;

      const emoticonsKey = `livechat-emoticon#${userStatusIdHash}`;
      const recentEmoticons = JSON.parse(
        localStorage.getItem(emoticonsKey) || "[]"
      );
      if (recentEmoticons.length === 0) return false;

      try {
        const response = await chrome.runtime.sendMessage({
          type: "GET_EMOJI_PACKS",
          userStatusIdHash,
        });

        if (!response || !response.success) {
          if (chrome.runtime.lastError)
            console.warn(
              "Communication channel closed:",
              chrome.runtime.lastError.message
            );
          else console.error("Failed to get emoji packs:", response?.error);
          return false;
        }

        const availableEmojiIds = new Set();
        const { emojiPacks, cheatKeyEmojiPacks, subscriptionEmojiPacks } =
          response.data;
        [emojiPacks, cheatKeyEmojiPacks, subscriptionEmojiPacks].forEach(
          (packs) => {
            if (packs)
              packs.forEach((pack) => {
                if (!pack.emojiPackLocked)
                  pack.emojis.forEach((emoji) =>
                    availableEmojiIds.add(emoji.emojiId)
                  );
              });
          }
        );

        const cleanedEmoticons = recentEmoticons.filter((e) =>
          availableEmojiIds.has(e.emojiId)
        );

        if (cleanedEmoticons.length !== recentEmoticons.length) {
          localStorage.setItem(emoticonsKey, JSON.stringify(cleanedEmoticons));
          return true;
        }
      } catch (error) {
        if (error.message.includes("Extension context invalidated")) {
          console.warn("Context invalidated as expected.");
        } else {
          console.error("Error removing expired emoticons:", error);
        }
      }
      return false;
    }

    /**
     * 기존의 이모티콘 삭제 및 UI 동기화 로직
     * @param {HTMLElement} container - #recent_emoticon element
     */
    syncUiWithLocalStorage(container) {
      const userStatusIdHash = localStorage.getItem("userStatus.idhash");
      if (!userStatusIdHash) return;

      const emoticonsKey = `livechat-emoticon#${userStatusIdHash}`;

      const realData = JSON.parse(localStorage.getItem(emoticonsKey) || "[]");
      const realEmojiIds = new Set(realData.map((e) => `emoji_${e.emojiId}`));

      const displayedItems = container.querySelectorAll("ul > li");

      displayedItems.forEach((item) => {
        if (!realEmojiIds.has(item.id)) {
          item.remove();
        }
      });
    }

    /**
     * 개별 이모티콘 삭제 버튼 설정
     * @param {HTMLElement} container - #recent_emoticon element
     */
    setupEmoticonDeleter(container) {
      this.syncUiWithLocalStorage(container);

      const userStatusIdHash = localStorage.getItem("userStatus.idhash");
      if (!userStatusIdHash) return;

      const emoticonsKey = `livechat-emoticon#${userStatusIdHash}`;
      const emoticonItems = container.querySelectorAll("ul > li");

      emoticonItems.forEach((item) => {
        // 이미 삭제 버튼이 있으면 건너뜀
        if (item.querySelector(".emoji-delete-btn")) return;

        const emojiId = item.id.replace("emoji_", "");
        if (!emojiId) return;

        const deleteButton = this.createDeleteButton(
          emojiId,
          emoticonsKey,
          item
        );
        item.appendChild(deleteButton);
      });
    }

    /**
     * 테마에 따른 삭제 버튼 스타일 업데이트
     */
    updateDeleteButtonStyles() {
      const isDark = document.documentElement.classList.contains("theme_dark");

      // 개별 삭제 버튼 스타일링
      document.querySelectorAll(".emoji-delete-btn").forEach((button) => {
        button.classList.toggle("bg-dark", isDark);
        button.classList.toggle("bg-white", !isDark);
      });

      const clearAllButton = document.querySelector("#clear-all-emoticons-btn");

      const deleteIconDarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="#000000"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>`;
      const deleteIconWhiteSvg = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="#FFFFFF"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>`;

      const desiredColor = isDark ? "#FFFFFF" : "#000000";
      const currentSvg = clearAllButton.querySelector("svg");

      // 현재 SVG가 없거나, 있더라도 색상이 현재 테마와 다를 경우에만 innerHTML을 변경
      if (!currentSvg || currentSvg.getAttribute("fill") !== desiredColor) {
        clearAllButton.innerHTML = isDark
          ? deleteIconWhiteSvg
          : deleteIconDarkSvg;
      }
    }

    /**
     * '사용한 이모티콘 없음' 메시지의 표시 여부를 업데이트하는 함수
     */
    updateEmptyMessageStatus() {
      const container = document.getElementById("recent_emoticon");
      if (!container) return;

      const list = container.querySelector("ul");
      if (!list) return;

      const emoticonCount = list.querySelectorAll("li").length;
      const messageElement = container.querySelector(
        "#recent-emoticon-empty-msg"
      );

      // 이모티콘이 하나도 없을 경우
      if (emoticonCount === 0) {
        // 메시지 태그가 아직 없다면 추가
        if (!messageElement) {
          this.createEmptyEmoticonPTag(container);
        }
      }
      // 이모티콘이 하나 이상 있을 경우
      else {
        // 메시지 태그가 존재한다면 제거
        if (messageElement) {
          messageElement.remove();
        }
      }
    }

    /**
     * '사용한 이모티콘 없음' 메시지를 생성하는 함수
     * @param {HTMLElement} container - 메시지를 추가할 부모 컨테이너
     */
    createEmptyEmoticonPTag(container) {
      const pTag = document.createElement("p");
      pTag.id = "recent-emoticon-empty-msg";
      pTag.innerText = "아직 사용한 이모티콘이 없어요..";

      container.appendChild(pTag);
    }

    /**
     * 전체 삭제 버튼 엘리먼트 생성
     */
    createClearAllButton() {
      const clearAllButton = document.createElement("button");
      clearAllButton.id = "clear-all-emoticons-btn";
      clearAllButton.addEventListener("click", () => this.clearAllEmoticons());
      return clearAllButton;
    }

    /**
     * 개별 삭제 버튼 엘리먼트 생성
     */
    createDeleteButton(emojiId, emoticonsKey, item) {
      const deleteButton = document.createElement("span");
      deleteButton.className = "emoji-delete-btn";
      deleteButton.innerText = "x";

      deleteButton.addEventListener("click", (e) => {
        this.deleteEmoticon(e, emojiId, emoticonsKey, item);
      });

      return deleteButton;
    }

    /**
     * 모든 이모티콘 삭제
     */
    clearAllEmoticons() {
      const userStatusIdHash = localStorage.getItem("userStatus.idhash");
      if (!userStatusIdHash) return;

      const emoticonsKey = `livechat-emoticon#${userStatusIdHash}`;
      try {
        localStorage.setItem(emoticonsKey, "[]");
        const emoticonList = document.querySelector("#recent_emoticon ul");

        if (emoticonList) {
          emoticonList.innerHTML = "";
        }
      } catch (error) {
        console.error("Failed to clear emoticons:", error);
      }
    }

    /**
     * 개별 이모티콘 삭제
     */
    deleteEmoticon(event, emojiId, emoticonsKey, item) {
      event.preventDefault();
      event.stopPropagation();
      try {
        const currentEmoticons = JSON.parse(
          localStorage.getItem(emoticonsKey) || "[]"
        );
        const updatedEmoticons = currentEmoticons.filter(
          (emoji) => emoji.emojiId !== emojiId
        );
        localStorage.setItem(emoticonsKey, JSON.stringify(updatedEmoticons));
        item.remove();
      } catch (error) {
        console.error(`Failed to delete emoticon ${emojiId}:`, error);
      }
    }

    /**
     * 팝업 리사이즈 핸들러를 설정하는 함수
     */
    initializeResizeHandler() {
      // mousedown 이벤트는 한번만 등록하기 위해 document에 위임(event delegation)
      document.body.addEventListener("mousedown", (e) => {
        // 클릭된 대상이 팝업 헤더가 아니면 무시
        const handle = e.target.closest(
          '#aside-chatting [class*="popup_header"]'
        );
        if (!handle) return;

        // 리사이즈할 대상인 팝업 컨테이너를 찾음
        const popupContainer = handle.closest(
          '#aside-chatting [class*="popup_container"]'
        );
        if (!popupContainer) return;

        e.preventDefault();

        // 드래그를 시작하면 부드러운 효과를 즉시 제거하여 지연 현상을 없앰
        popupContainer.classList.remove("smooth-transition");

        this.isResizing = true;

        // 리사이즈 시작 시점의 마우스 Y좌표와 컨테이너의 높이를 저장
        const startY = e.pageY;
        const startHeight = popupContainer.offsetHeight;

        // body에 'resizing' 클래스를 추가하여 텍스트 선택 방지
        document.body.classList.add("resizing");

        // --- 마우스 이동(mousemove) 이벤트 핸들러 ---
        const doDrag = (e) => {
          // 시작 지점으로부터의 마우스 이동 거리 계산
          const deltaY = startY - e.pageY;
          // 새로운 높이 계산
          let newHeight = startHeight + deltaY;

          // 최소/최대 높이 제한
          if (newHeight < 150) newHeight = 150; // 최소 높이 150px
          if (newHeight > 700) newHeight = 700; // 최대 높이 700px

          // 컨테이너에 새로운 높이 적용
          popupContainer.style.height = `${newHeight}px`;
        };

        // --- 마우스 버튼 놓기(mouseup) 이벤트 핸들러 ---
        const stopDrag = () => {
          // body에서 'resizing' 클래스 제거
          document.body.classList.remove("resizing");
          // 이벤트 리스너 정리
          document.removeEventListener("mousemove", doDrag);
          document.removeEventListener("mouseup", stopDrag);

          // 드래그를 마치면, 다음 활성화 애니메이션을 위해 부드러운 효과를 다시 켤 준비
          popupContainer.classList.add("smooth-transition");

          this.isResizing = false;

          // *** 컨텍스트 유효성 검사 ***
          if (
            typeof chrome === "undefined" ||
            !chrome.runtime ||
            !chrome.runtime.id
          ) {
            return;
          }

          // 최종 높이를 chrome.storage에 저장
          const finalHeight = popupContainer.offsetHeight;
          chrome.storage.local.set({ chzzkEmoticonPopupHeight: finalHeight });
        };

        // document에 mousemove와 mouseup 이벤트 리스너를 등록하여
        // 마우스가 헤더 밖으로 나가도 리사이즈가 계속되도록 함
        document.addEventListener("mousemove", doDrag);
        document.addEventListener("mouseup", stopDrag);
      });
    }

    /**
     * 'e' 키 단축키를 처리하는 함수
     * @param {KeyboardEvent} event - 키보드 이벤트 객체
     */
    handleEmoticonShortcut(event) {
      // *** 컨텍스트 유효성 검사 ***
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      // 1. 누른 키가 'e'가 아니면 무시
      if (event.code !== "KeyE") {
        return;
      }

      // 2. 사용자가 텍스트 입력 필드에 입력 중인 경우 무시
      const target = event.target;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "PRE";
      target.isContentEditable;
      if (isTyping) {
        return;
      }

      // 3. 이모티콘 버튼을 찾음
      const emoticonButton = document.querySelector(
        '#aside-chatting [class*="button_container"][aria-haspopup="true"]'
      );

      // 4. 버튼이 존재하면 클릭 이벤트를 실행
      if (emoticonButton) {
        // 기본 동작('e'키 입력)을 막고, 버튼을 클릭
        event.preventDefault();
        emoticonButton.click();
      }
    }

    /**
     * 이모티콘 버튼에 커스텀 단축키 툴팁을 추가하는 함수
     */
    applyShortcutTooltip() {
      // *** 컨텍스트 유효성 검사 ***
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      const emoticonButton = document.querySelector(
        '#aside-chatting [class*="button_container"][aria-haspopup="true"]'
      );
      if (!emoticonButton) {
        return;
      }

      // 1. 이미 툴팁이 내부에 추가되었는지 확인하여 중복 실행을 방지
      if (emoticonButton.querySelector(".tooltip-text")) {
        return;
      }

      // 2. 툴팁 텍스트를 담을 span 생성
      const tooltipText = document.createElement("span");
      tooltipText.className = "tooltip-text";
      tooltipText.textContent = "(E)";

      // 3. 툴팁 wrapper 역할을 할 클래스를 버튼 자체에 부여
      emoticonButton.classList.add("cheemoticon-tooltip");

      // 4. 툴팁 텍스트를 버튼의 자식으로 추가
      emoticonButton.appendChild(tooltipText);
    }

    /**
     * 'esc' 키를 처리하여 contenteditable을 textarea로 되돌리는 함수
     * @param {KeyboardEvent} event - 키보드 이벤트 객체
     */
    handleEscapeKey(event) {
      // *** 컨텍스트 유효성 검사 ***
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      // 1. 누른 키가 'Escape'가 아니면 무시
      if (event.key !== "Escape") {
        return;
      }

      // 2. 현재 포커스된 요소(이벤트 타겟)를 찾음
      const target = event.target;

      // 3. 타겟이 contenteditable 속성을 가진 <pre> 태그인지, 그리고 비어있는지 확인
      const isEditablePre =
        target.tagName === "PRE" && target.isContentEditable;
      const isEmpty = target.textContent.trim() === "";

      const emoticonButton = document.querySelector(
        '#aside-chatting [class*="button_container"][aria-haspopup="true"]'
      );

      // case 1: 비어있는 채팅 입력창에서 ESC를 누른 경우
      if (isEditablePre && isEmpty) {
        event.preventDefault(); // 기본 동작을 막음
        event.stopPropagation(); // 이벤트 전파를 막아 다른 리스너의 동작을 원천 차단
        document.activeElement.blur();

        if (
          emoticonButton &&
          emoticonButton.getAttribute("aria-expanded") === "true"
        ) {
          emoticonButton.click();
        }
        return;
      }

      // case 2: 이모티콘 창만 열려있는 경우
      if (
        emoticonButton &&
        emoticonButton.getAttribute("aria-expanded") === "true"
      ) {
        event.preventDefault();
        event.stopPropagation();
        emoticonButton.click();
      }
    }

    /**
     * 채팅 입력창의 placeholder를 감시하고 업데이트하는 함수
     */
    updateInputPlaceholder() {
      // 현재 페이지가 팝업 채팅창이 아니면 아무 작업도 하지 않고 종료
      if (!window.location.pathname.endsWith("/chat")) {
        return;
      }
      // 컨텍스트 유효성 검사
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      const textarea = document.querySelector(
        '#aside-chatting textarea[class*="live_chatting_input_input"]'
      );

      if (!textarea || textarea.placeholder.includes("(J)")) {
        return;
      }

      textarea.placeholder += " (J)";
    }

    /**
     * 'j' 키 단축키를 처리하는 함수
     * @param {KeyboardEvent} event - 키보드 이벤트 객체
     */
    handleInputShortcut(event) {
      // 현재 페이지가 팝업 채팅창이 아니면 아무 작업도 하지 않고 종료
      if (!window.location.pathname.endsWith("/chat")) {
        return;
      }

      // *** 컨텍스트 유효성 검사 ***
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      if (event.code !== "KeyJ") {
        return;
      }

      const target = event.target;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "PRE";
      target.isContentEditable;
      if (isTyping) {
        return;
      }

      const textarea = document.querySelector(
        '#aside-chatting textarea[class*="live_chatting_input_input"]'
      );

      if (!textarea) {
        return;
      }

      event.preventDefault();
      textarea.focus();
    }
  }

  // 확장 프로그램 인스턴스 생성 및 실행
  const emoticonExtension = new EmoticonExtension();

  // 전역 변수에 현재 인스턴스를 할당
  window.myEmoticonExtensionInstance = emoticonExtension;

  window.addEventListener("beforeunload", () => {
    const observer = emoticonExtension.observers.get("main");
    if (observer) {
      observer.disconnect();
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_USER_HASH") {
      const userHash = localStorage.getItem("userStatus.idhash");
      sendResponse({ userStatusIdHash: userHash });
      return true; // 비동기 응답을 위해 true 반환
    }
  });
});
