(function () {
  // localStorage.setItem 함수에 이미 우리만의 표식이 있다면,
  // 이 스크립트가 이미 실행된 것이므로 아무것도 하지 않고 즉시 종료
  if (window.localStorage.setItem.isPatchedByCheemoticon) {
    return;
  }
  // 1. 기존의 localStorage.setItem 함수를 백업
  const originalSetItem = window.localStorage.setItem;

  // 2. 확장 프로그램에서 전달받을 최대 이모티콘 개수를 저장할 변수
  let maxEmoticonCount = 20;

  // 3. content.js로부터 최대 개수 값을 받기 위한 리스너
  window.addEventListener("message", (event) => {
    // 메시지 출처가 신뢰할 수 있는지 확인
    if (
      event.source === window &&
      event.data.type === "CHZZK_EMOTICON_MAX_COUNT_UPDATE"
    ) {
      maxEmoticonCount = event.data.maxCount;
    }
  });

  // 4. window.localStorage.setItem 함수를 우리의 감시 기능이 포함된 새 함수로 덮어씀
  window.localStorage.setItem = function (key, value) {
    // 5. 이모티콘 저장 키가 아닐 경우, 원래 함수를 그대로 실행하고 종료
    if (!key.startsWith("livechat-emoticon#")) {
      originalSetItem.apply(localStorage, arguments);
      return;
    }

    try {
      const currentData = JSON.parse(localStorage.getItem(key) || "[]");
      const newDataFromChzzk = JSON.parse(value);

      // 6. 지직의 의도와 상관없이 항상 목록을 재구성

      // 치지직이 전달한 목록이 비어있으면 무시 (예: 전체 삭제)
      if (newDataFromChzzk.length === 0) {
        originalSetItem.apply(localStorage, arguments);
        return;
      }

      // 방금 사용된 이모티콘은 항상 치지직이 전달한 목록의 첫 번째 요소
      const lastUsedEmoticon = newDataFromChzzk[0];

      // 기존 목록(currentData)에서 방금 사용한 것을 제외하여 중복을 방지
      const otherEmoticons = currentData.filter(
        (e) => e.emojiId !== lastUsedEmoticon.emojiId
      );

      // 최종 목록: 방금 사용한 것을 맨 앞에 놓고, 나머지를 뒤에 붙임
      const reorderedData = [lastUsedEmoticon, ...otherEmoticons];

      // 사용자가 설정한 최대 개수만큼 목록을 유지
      const finalData = reorderedData.slice(0, maxEmoticonCount);

      // 재구성한 최종 데이터를 인자로 하여 원래 setItem 함수를 호출하여 저장
      originalSetItem.call(localStorage, key, JSON.stringify(finalData));
      return;
    } catch (e) {
      // JSON 파싱 오류 등 예외가 발생하면 원래 로직을 그대로 따름
    }

    // 7. 예외 발생 시 원래 함수를 그대로 실행
    originalSetItem.apply(localStorage, arguments);
  };

  // 코드가 적용되었다는 표식을 남겨 중복 실행을 방지
  window.localStorage.setItem.isPatchedByCheemoticon = true;
})();
