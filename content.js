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
      this.init();
    }

    // Observer 등을 모두 중지시키는 정리(cleanup) 메서드
    cleanup() {
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
    }

    /**
     * 확장 프로그램 초기화: DOM 변경 시마다 기능 적용을 시도
     */
    init() {
      const mainObserver = new MutationObserver(() => {
        // DOM에 어떤 변화든 감지되면, 무조건 기능 적용 함수를 호출
        this.applyRecentEmoticonFeatures();
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
    }

    /**
     * UI 관련 모든 설정을 적용하는 함수. 여러 번 호출해도 안전
     * @param {HTMLElement} container - #recent_emoticon element
     */
    applyUiSettings(container) {
      // 1. 전체 삭제 버튼과 wrapper 설정
      const titleElement = container.querySelector("strong");
      if (
        titleElement &&
        !titleElement.parentNode.classList.contains("emoticon-subtitle-wrapper")
      ) {
        const titleWrapper = document.createElement("div");
        titleWrapper.className = "emoticon-subtitle-wrapper";
        titleElement.parentNode.insertBefore(titleWrapper, titleElement);
        titleWrapper.appendChild(titleElement);
        const clearAllButton = this.createClearAllButton();
        titleWrapper.appendChild(clearAllButton);
      }

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
});
