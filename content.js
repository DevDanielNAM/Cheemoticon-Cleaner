if (!window.__cheemo_initialized__) {
  window.__cheemo_initialized__ = true;

  window.__cheemo_state__ = window.__cheemo_state__ || { enabled: true };
  function setEnabled(on) {
    window.__cheemo_state__.enabled = on;
    if (on) {
      // 다시 켜질 때: 루트 감시 + 필터 바인딩 보장
      ensureChatRootObserver();
      const root = document.querySelector(
        "[class*=live_chatting_list_container__],[class*=vod_chatting_list__]"
      );
      if (root) installChatEmojiFilter(root);

      // 이모티콘 크기 조절 기능 다시 켜기
      (async () => {
        // 1. 저장된 크기를 다시 읽어옴
        const { chzzkEmojiSize = 32 } = await safeLocalGet("chzzkEmojiSize");
        __cheemo_sizePx = chzzkEmojiSize;
        // 2. 컨테이너 옵저버를 다시 연결하고, 그리드를 즉시 재계산
        ensureContainerObserver();
      })();

      // 이모티콘 관련 UI/옵저버 기능(최근/툴팁/리사이즈 등)도 켜기
      if (!window.myEmoticonExtensionInstance && window.EmoticonExtension) {
        window.myEmoticonExtensionInstance = new window.EmoticonExtension();
      }
    } else {
      // 끌 때: 옵저버/리스너 해제 + 숨긴 이모티콘 원복
      try {
        if (window.__cheemo_chat_mo__) {
          window.__cheemo_chat_mo__.disconnect();
          window.__cheemo_chat_mo__ = null;
        }
        if (
          window.__cheemo_chat_click_listener__ &&
          window.__cheemo_chat_root
        ) {
          window.__cheemo_chat_root.removeEventListener(
            "click",
            window.__cheemo_chat_click_listener__,
            true
          );
        }
      } catch {}
      const root = document.querySelector(
        "[class*=live_chatting_list_container__],[class*=vod_chatting_list__]"
      );
      if (root) {
        root.querySelectorAll("img").forEach((img) => {
          img.style.display = "";
        });
        root
          .querySelectorAll(
            "[class*=live_chatting_message_button__], [class*=live_chatting_scroll_message__]"
          )
          .forEach((btn) => {
            btn.style.display = "";
          });
      }
      // 이모티콘 크기 스타일(CSS) 엘리먼트 제거
      if (window.__cheemo_styleEl) {
        window.__cheemo_styleEl.remove();
        window.__cheemo_styleEl = null;
      }
      // 그리드 크기 조절 옵저버 중지
      if (window.__cheemo_resize_observer) {
        try {
          window.__cheemo_resize_observer.disconnect();
        } catch (e) {}
        window.__cheemo_resize_observer = null;
      }
      if (window.__cheemo_container_observer) {
        try {
          window.__cheemo_container_observer.disconnect();
        } catch (e) {}
        window.__cheemo_container_observer = null;
      }
      if (window.myEmoticonExtensionInstance) {
        window.myEmoticonExtensionInstance.cleanup?.();
        window.myEmoticonExtensionInstance = null;
      }
    }
  }

  // 항상 살아있는 메시지 리스너 (OFF여도 응답)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case "CHEEMO_PING":
        sendResponse({
          alive: true,
          enabled: window.__cheemo_state__?.enabled,
        });
        return; // 동기 응답

      case "CHEEMO_ENABLE":
        setEnabled(true);

        // 'OFF' 또는 '설치' 배너가 혹시 남아있다면 제거
        const banner = document.getElementById(
          "chzzk-cheemo-ext-update-banner"
        );
        if (banner) banner.remove();

        sendResponse({ ok: true, enabled: true });
        return;

      case "CHEEMO_DISABLE":
        setEnabled(false);
        sendResponse({ ok: true, enabled: false });
        return;

      case "GET_USER_HASH":
        try {
          const userHash = localStorage.getItem("userStatus.idhash") || null;
          sendResponse({ userStatusIdHash: userHash });
        } catch {
          sendResponse({ userStatusIdHash: null });
        }
        return;
    }
  });
}

// 전역 window 객체에 현재 스크립트의 실행 여부를 기록
if (window.myEmoticonExtensionInstance) {
  // 이전 버전의 Observer 등을 정리하는 함수를 호출
  window.myEmoticonExtensionInstance.cleanup();
}

window.CONTEXT_ALIVE = true;

window.__cheemo_chat_root = window.__cheemo_chat_root ?? null; // 현재 리스너가 붙은 채팅 루트
window.__cheemo_chat_root_observer = window.__cheemo_chat_root_observer ?? null; // 루트 등장/교체 감시자
window.__cheemo_sizePx = window.__cheemo_sizePx ?? 32;
window.__cheemo_styleEl = window.__cheemo_styleEl ?? null;
window.__cheemo_resize_observer = window.__cheemo_resize_observer ?? null;
window.__cheemo_container_observer = window.__cheemo_container_observer ?? null;

function safeLocalSet(obj) {
  if (!chrome?.runtime?.id) return false; // 컨텍스트 종료면 그냥 패스
  try {
    chrome.storage.local.set(obj);
    return true;
  } catch (e) {
    if (String(e).includes("Extension context invalidated")) {
      console.warn("Context invalidated while saving:", obj);
      return false;
    }
    throw e;
  }
}

async function safeLocalGet(keyOrKeys) {
  if (!chrome?.runtime?.id) return {};
  try {
    return await chrome.storage.local.get(keyOrKeys);
  } catch (e) {
    if (String(e).includes("Extension context invalidated")) {
      console.warn("Context invalidated while getting:", keyOrKeys);
      return {};
    }
    throw e;
  }
}

function ensureSizeStyleEl() {
  if (!__cheemo_styleEl) {
    __cheemo_styleEl = document.getElementById("cheemoticon-size-style");
    if (!__cheemo_styleEl) {
      __cheemo_styleEl = document.createElement("style");
      __cheemo_styleEl.id = "cheemoticon-size-style";
      document.head.appendChild(__cheemo_styleEl);
    }
  }
  return __cheemo_styleEl;
}

// 컨테이너 폭으로 적정 열 개수(n)와 colGap 계산
function computeColumnsAndGap(
  container,
  cell,
  {
    minGap = 4, // 최소 간격
    maxGap = 20, // 최대 간격(과도하게 벌어짐 방지)
    paddingAware = true,
  } = {}
) {
  if (!container) return { n: 1, gap: minGap };

  const cs = getComputedStyle(container);
  const pl = paddingAware ? parseFloat(cs.paddingLeft || "0") : 0;
  const pr = paddingAware ? parseFloat(cs.paddingRight || "0") : 0;

  // 실제 사용할 내부 폭
  const W = container.clientWidth - pl - pr;
  const safeCell = Math.max(24, cell); // 너무 작지 않게 보호

  // 1) 최소 gap 가정으로 열 개수 산출
  let n = Math.max(1, Math.floor((W + minGap) / (safeCell + minGap)));

  // 2) 남는 공간을 (n-1)개 gap으로 나눔
  let gap = n > 1 ? Math.floor((W - n * safeCell) / (n - 1)) : 0;
  gap = Math.max(minGap, Math.min(maxGap, gap));

  // 3) 새 gap으로 다시 한 번 n을 조정(간혹 한 열 더 들어갈 수 있는 경우)
  const tryN = Math.floor((W + gap) / (safeCell + gap));
  if (tryN > n) n = tryN;

  // 마지막 안전 체크: 과적재 방지
  while (n > 1 && n * safeCell + (n - 1) * gap > W) {
    n--;
  }
  return { n: Math.max(1, n), gap: Math.max(0, gap) };
}

function recomputeGrid(sizePx) {
  // 삭제 버튼 크기(셀/이미지에 비례, 너무 작거나 크지 않게 클램프)
  const del = Math.max(12, Math.min(20, Math.round(sizePx * 0.45)));
  const delFont = Math.max(10, Math.round(del * 0.72));

  __cheemo_sizePx = sizePx; // 최신값 저장
  const cell = Math.max(sizePx + 8, 24);
  const rowGap = 6;

  const container = document.querySelector("[class*=emoticon_list__]");

  let n = 1,
    colGap = 6;
  if (container) {
    const res = computeColumnsAndGap(container, cell, {
      minGap: 4,
      maxGap: 16,
    });
    n = res.n;
    colGap = res.gap;
  }

  const styleEl = ensureSizeStyleEl();
  styleEl.textContent = `
     [class*=emoticon_list__] img {
      width: ${sizePx}px !important;
      height: ${sizePx}px !important;
      display: block;
    }

    /* 그리드 칸 크기(열/행)와 간격을 함께 조정 */
    [class*=emoticon_list__] {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, ${cell}px) !important;
      grid-auto-rows: ${cell}px !important;
      row-gap: ${rowGap}px !important;
      column-gap: ${colGap}px !important;
      justify-content: start !important;
      padding: 0 5px; 
    }

    /* 각 셀(li)을 셀 크기에 맞춰 정렬 */
    [class*=emoticon_list__] > li {
      width: ${cell}px !important;
      height: ${cell}px !important;
      box-sizing: border-box !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      position: relative !important;
    }

    /* 삭제 버튼을 항상 좌상단(또는 우상단) 고정 */
    [class*=emoticon_list__] > li .emoji-delete-btn {
      width: ${del}px;
      height: ${del}px;
      line-height: ${del - 2}px;
      font-size: ${delFont}px;
    }

    [class*=emoticon_list__] > li .emoji-delete-btn > svg {
      width: ${sizePx < 28 ? 4 : sizePx < 40 ? 6 : 8}px;
      height: ${sizePx < 28 ? 4 : sizePx < 40 ? 6 : 8}px;
    }
  `;

  // 컨테이너가 있으면 리사이즈 감시 설치/갱신
  if (container) {
    if (__cheemo_resize_observer) {
      try {
        __cheemo_resize_observer.disconnect();
      } catch {}
    }
    __cheemo_resize_observer = new ResizeObserver(() => {
      // 폭이 변하면 현재 크기 기준으로 재계산
      recomputeGrid(__cheemo_sizePx);
    });
    __cheemo_resize_observer.observe(container);
  }
}

function ensureContainerObserver() {
  if (__cheemo_container_observer) return;

  __cheemo_container_observer = new MutationObserver(() => {
    const container = document.querySelector("[class*=emoticon_list__]");
    if (container) {
      // 컨테이너가 나타나는 즉시 현재 크기로 재계산
      recomputeGrid(__cheemo_sizePx);
    }
  });
  __cheemo_container_observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 이미 존재한다면 즉시 1회 실행
  if (document.querySelector("[class*=emoticon_list__]")) {
    recomputeGrid(__cheemo_sizePx);
  }
}

// src를 '키'로 표준화(쿼리 제거)
function emojiKeyFromSrc(src) {
  try {
    const u = new URL(src, location.href);
    u.search = ""; // ?type=f60_60 같은 변형 제거
    return u.href;
  } catch {
    // 절대/상대 경로 혼재 시 단순 폴백
    return src.split("?")[0];
  }
}

// 전역: 블랙리스트 Set 관리
window.EMOJI_BLOCKSET = window.EMOJI_BLOCKSET ?? new Set();

async function loadEmojiBlockset() {
  const { chzzkEmojiBlocklist = [] } = await safeLocalGet(
    "chzzkEmojiBlocklist"
  );
  EMOJI_BLOCKSET = new Set(chzzkEmojiBlocklist);
}

// 숨김/복원 통합 처리
function updateEmojiVisibility(imgEl) {
  const key = emojiKeyFromSrc(imgEl.src);
  const blocked = EMOJI_BLOCKSET.has(key);

  const btn = imgEl.closest(
    "[class*=live_chatting_message_button__], [class*=live_chatting_scroll_message__]"
  );
  if (btn) {
    // 버튼 단위로 숨김/복원
    btn.style.display = blocked ? "none" : "";
  } else {
    // fallback: 이미지만 숨김/복원
    imgEl.style.display = blocked ? "none" : "";
  }
}

// 채팅 컨테이너에 옵저버/위임
function installChatEmojiFilter(root) {
  if (!root) return;

  // 이전 리스너/옵저버 제거
  if (window.__cheemo_chat_click_listener__) {
    root.removeEventListener(
      "click",
      window.__cheemo_chat_click_listener__,
      true
    );
  }
  if (window.__cheemo_chat_mo__) {
    try {
      window.__cheemo_chat_mo__.disconnect();
    } catch {}
  }

  // 새 핸들러 등록
  const handler = (e) => {
    if (!CONTEXT_ALIVE || !chrome?.runtime?.id) return;
    const target = e.target;
    if (!(target instanceof HTMLImageElement)) return;
    if (
      !target.closest(
        "[class*=live_chatting_message_button__],[class*=live_chatting_scroll_message__]"
      )
    )
      return;
    if (!e.altKey) return;

    e.preventDefault();
    e.stopPropagation();
    const key = emojiKeyFromSrc(target.src);
    if (!EMOJI_BLOCKSET.has(key)) {
      EMOJI_BLOCKSET.add(key);
      safeLocalSet({ chzzkEmojiBlocklist: Array.from(EMOJI_BLOCKSET) }); // 안전 저장
      updateEmojiVisibility(target);
    }
  };
  window.__cheemo_chat_click_listener__ = handler;
  root.addEventListener("click", handler, true);

  // 초기 스캔
  root
    .querySelectorAll(
      "[class*=live_chatting_message_text__] img, [class*=live_chatting_scroll_message__] img"
    )
    .forEach(updateEmojiVisibility);

  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      (m.addedNodes || []).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;

        if (
          node.matches(
            "[class*=live_chatting_message_text__], [class*=live_chatting_message_button__], [class*=live_chatting_scroll_message__]"
          )
        ) {
          node.querySelectorAll("img").forEach(updateEmojiVisibility);
        } else {
          node
            .querySelectorAll?.(
              "[class*=live_chatting_message_text__] img, [class*=live_chatting_message_button__] img, [class*=live_chatting_scroll_message__] img"
            )
            .forEach(updateEmojiVisibility);
        }
      });
    }
  });
  mo.observe(root, { childList: true, subtree: true });
  // 나중에 OFF/재바인딩 시 disconnect 하려면 전역에 보관
  window.__cheemo_chat_mo__ = mo;
}

(() => {
  if (window.EmoticonExtension) return;
  /**
   * 확장 프로그램의 메인 클래스
   * 모든 기능을 캡슐화하고 상태를 관리
   */
  class EmoticonExtension {
    constructor() {
      this.observers = new Map();
      this.isResizing = false;
      this.currentMax = null;
      this.isDeletionLocked = false;
      this.init();
    }

    // Observer 등을 모두 중지시키는 정리(cleanup) 메서드
    cleanup() {
      this.observers.forEach((observer) => observer.disconnect());
      this.observers.clear();
      document.removeEventListener("keydown", this.handleEmoticonShortcut);
      document.removeEventListener("keydown", this.handleEscapeKey);
      document.removeEventListener("keydown", this.handleInputShortcut);
      document.body.removeEventListener(
        "mousedown",
        this.handleResizeMouseDown
      );
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
      this.handleResizeMouseDown = this.handleResizeMouseDown.bind(this);
      this.injectAndCommunicate();

      chrome.storage.local.get("isDeletionLocked", (data) => {
        this.isDeletionLocked = !!data.isDeletionLocked;
      });

      let pending = false;
      const mainObserver = new MutationObserver(() => {
        // DOM에 어떤 변화든 감지되면, 무조건 기능 적용 함수를 호출
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          this.applyShortcutTooltip();
          this.updateInputPlaceholder();
          this.applyRecentEmoticonFeatures();
        });
      });

      const popupRoot = document.body;
      this.observers.set("main", mainObserver);
      if (popupRoot) {
        mainObserver.observe(popupRoot, {
          childList: true,
          subtree: true,
        });
      }

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

        if (namespace === "local" && changes.chzzkEmojiSize) {
          __cheemo_sizePx = changes.chzzkEmojiSize.newValue;
          recomputeGrid(__cheemo_sizePx);
        }

        if (namespace === "local" && changes.emoticonOrder) {
          // 재정렬 가드 해제
          const container = document.querySelector(".flicking-camera");
          if (container) container.removeAttribute("data-reordered");
          // DOM 안정화 후 강제 재정렬
          requestAnimationFrame(() => {
            try {
              this.reorderEmoticonCategories();
            } catch {}
          });
        }

        if (namespace === "local" && changes.chzzkEmojiBlocklist) {
          EMOJI_BLOCKSET = new Set(changes.chzzkEmojiBlocklist.newValue || []);
          // 반영: 현재 표시 중인 img들 다시 스캔(간단히 루트 재스캔)
          const root = document.querySelector(
            "[class*=live_chatting_list_container__],[class*=vod_chatting_list__]"
          );
          root
            ?.querySelectorAll(
              "[class*=live_chatting_message_text__] img, [class*=live_chatting_scroll_message__] img"
            )
            .forEach(updateEmojiVisibility);
        }
      });
    }

    /**
     * 지정된 스크립트 파일을 페이지의 DOM에 삽입하는 유틸리티 함수
     * @param {string} filePath - 확장 프로그램 루트 기준 파일 경로
     */
    injectScript(filePath, force = false, version) {
      return new Promise((resolve) => {
        const ver = version || Date.now();
        // force=false면 기존 가드 유지, force=true면 무조건 재주입
        if (!force && window.cheemoticonInjected) {
          resolve();
          return;
        }
        const s = document.createElement("script");
        s.src = chrome.runtime.getURL(filePath) + "?v=" + ver;
        // 스크립트 로드가 끝나면 DOM에서 제거하여 흔적을 남기지 않음
        s.onload = () => {
          s.remove();
          // 현재 적용된 빌드 식별자 저장(디버깅/중복 방지)
          window.cheemoticonInjected = s.src;
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

        this.createOrUpdateLockButton(titleWrapper);
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
     * 잠금 버튼을 생성하거나 업데이트하는 함수
     * @param {HTMLElement} wrapper - 버튼들을 감싸는 부모 요소
     */
    createOrUpdateLockButton(wrapper) {
      let lockButton = document.getElementById("lock-emoticon-deletion-btn");

      if (!lockButton) {
        lockButton = document.createElement("button");
        lockButton.id = "lock-emoticon-deletion-btn";
        lockButton.title = "이모티콘 삭제 잠금";

        // 아이콘 SVG들
        const unlockIconSVG = `<svg class="unlocked-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M16 10V7a4 4 0 10-8 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
      <circle cx="12" cy="15" r="1.5" fill="currentColor"/>
    </svg>`;
        const lockIconSVG = `<svg class="locked-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M7 10V7a5 5 0 1110 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="15" r="1.5" fill="currentColor"/>
      </svg>`;

        lockButton.innerHTML = unlockIconSVG + lockIconSVG;

        lockButton.addEventListener("click", () => this.toggleDeletionLock());

        const clearAllButton = wrapper.querySelector(
          "#clear-all-emoticons-btn"
        );
        wrapper.insertBefore(lockButton, clearAllButton);
      }

      this.applyLockStateToUI();
    }

    /**
     * 잠금 상태를 토글하고 저장하는 함수
     */
    toggleDeletionLock() {
      // *** 컨텍스트 유효성 검사 ***
      if (
        typeof chrome === "undefined" ||
        !chrome.runtime ||
        !chrome.runtime.id
      ) {
        return;
      }

      this.isDeletionLocked = !this.isDeletionLocked;
      chrome.storage.local.set({ isDeletionLocked: this.isDeletionLocked });
      this.applyLockStateToUI();
    }

    /**
     * 현재 잠금 상태를 UI에 적용하는 함수
     */
    applyLockStateToUI() {
      const container = document.getElementById("recent_emoticon");
      if (!container) return;

      container.classList.toggle("emoticons-locked", this.isDeletionLocked);

      const lockButton = document.getElementById("lock-emoticon-deletion-btn");
      if (lockButton) {
        const unlockedIcon = lockButton.querySelector(".unlocked-icon");
        const lockedIcon = lockButton.querySelector(".locked-icon");
        if (unlockedIcon && lockedIcon) {
          unlockedIcon.style.display = this.isDeletionLocked ? "none" : "block";
          lockedIcon.style.display = this.isDeletionLocked ? "block" : "none";
        }
      }
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
      deleteButton.innerHTML = `<svg width="8" height="8" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;

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
      document.body.addEventListener("mousedown", this.handleResizeMouseDown);
    }

    /**
     * 리사이즈 mousedown 이벤트 핸들러
     */
    handleResizeMouseDown(e) {
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

        if (!CONTEXT_ALIVE || !chrome?.runtime?.id) return;
        safeLocalSet({ chzzkEmoticonPopupHeight: finalHeight });
      };

      // document에 mousemove와 mouseup 이벤트 리스너를 등록하여
      // 마우스가 헤더 밖으로 나가도 리사이즈가 계속되도록 함
      document.addEventListener("mousemove", doDrag);
      document.addEventListener("mouseup", stopDrag);
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

      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
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

      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
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
  window.EmoticonExtension = EmoticonExtension; // 전역 프로퍼티로만 노출
})();

// 확장 프로그램 인스턴스 생성 및 실행
window.emoticonExtension =
  window.emoticonExtension || new window.EmoticonExtension();

// 전역 변수에 현재 인스턴스를 할당
window.myEmoticonExtensionInstance = window.emoticonExtension;

(async () => {
  const { chzzkEmojiSize = 32 } = await safeLocalGet("chzzkEmojiSize");
  __cheemo_sizePx = chzzkEmojiSize;
  recomputeGrid(__cheemo_sizePx); // 지금 당장 컨테이너가 없어도 OK(나중에 다시 계산됨)

  await loadEmojiBlockset();
  ensureContainerObserver(); // 컨테이너 등장/교체 감시

  // 새 탭/SPA 전환에서도 자동 재바인딩
  ensureChatRootObserver();
  const { isPaused = false } = await chrome.storage.local.get("isPaused");
  setEnabled(!isPaused); // 시작 시 ON/OFF 반영

  const root = document.querySelector(
    "[class*=live_chatting_list_container__],[class*=vod_chatting_list__]"
  );
  if (root) installChatEmojiFilter(root); // 초기 페이지에서도 즉시 바인딩
})();

function ensureChatRootObserver() {
  if (__cheemo_chat_root_observer) return;

  const rebind = () => {
    const root = document.querySelector(
      "[class*=live_chatting_list_container__],[class*=vod_chatting_list__]"
    );
    if (!root || root === __cheemo_chat_root) return;

    // 이전 루트에 붙어 있던 리스너/옵저버 정리
    if (__cheemo_chat_root) {
      if (window.__cheemo_chat_click_listener__) {
        __cheemo_chat_root.removeEventListener(
          "click",
          window.__cheemo_chat_click_listener__,
          true
        );
      }
      if (window.__cheemo_chat_mo__) {
        try {
          window.__cheemo_chat_mo__.disconnect();
        } catch {}
        window.__cheemo_chat_mo__ = null;
      }
    }

    // 새 루트로 교체하고 필터 설치
    __cheemo_chat_root = root;
    installChatEmojiFilter(__cheemo_chat_root);

    // 블록셋이 이미 로드되어 있다면 즉시 한 번 더 전체 적용
    __cheemo_chat_root
      .querySelectorAll(
        "[class*=live_chatting_message_text__] img, [class*=live_chatting_scroll_message__] img"
      )
      .forEach(updateEmojiVisibility);
  };

  // DOM 변화 감시: 루트가 나타나거나 교체되면 rebind
  __cheemo_chat_root_observer = new MutationObserver(rebind);
  __cheemo_chat_root_observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // SPA 네비게이션 대응: pushState/replaceState/popstate 때도 재확인
  const wrapHistory = (fn) =>
    function (...args) {
      const r = fn.apply(history, args);
      setTimeout(rebind, 0);
      return r;
    };
  if (!history.__cheemo_patched) {
    history.pushState = wrapHistory(history.pushState);
    history.replaceState = wrapHistory(history.replaceState);
    window.addEventListener("popstate", rebind);
    history.__cheemo_patched = true;
  }

  // 이미 존재하면 즉시 1회 바인딩
  rebind();
}

window.addEventListener("beforeunload", () => {
  CONTEXT_ALIVE = false;

  const observer = window.emoticonExtension?.observers?.get("main");
  if (observer) {
    observer.disconnect();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "CHEEMO_REINJECT") {
    (async () => {
      await emoticonExtension.injectScript(
        "inject.js",
        /*force*/ true,
        request.version
      );
      sendResponse({ ok: true, reinjected: true, v: request.version });
    })();
    return true; // async
  }

  if (request.type === "GET_USER_HASH") {
    const userHash = localStorage.getItem("userStatus.idhash");
    sendResponse({ userStatusIdHash: userHash });
    return true; // 비동기 응답을 위해 true 반환
  }
});
