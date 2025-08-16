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
