/**
 * 키워드 기반 무작위 안전 패스워드 생성기
 * 알파벳 대문자(A-Z), 소문자(a-z), 숫자(0-9), 특수문자를 모두 반드시 포함합니다.
 */

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SPECIALS = '!@#$%^&*()_+~|}{[]:;?><,./-=';
const ALL_CHARS = UPPERCASE + LOWERCASE + NUMBERS + SPECIALS;

/**
 * 특정 문자 집합에서 무작위 문자를 n개 선택
 */
function getRandomChars(charSet, count = 1) {
  let result = '';
  const cryptoObj = typeof window !== 'undefined' && window.crypto ? window.crypto : null;
  
  if (cryptoObj && cryptoObj.getRandomValues) {
    const randomBuffer = new Uint32Array(count);
    cryptoObj.getRandomValues(randomBuffer);
    for (let i = 0; i < count; i++) {
      result += charSet[randomBuffer[i] % charSet.length];
    }
  } else {
    for (let i = 0; i < count; i++) {
      result += charSet[Math.floor(Math.random() * charSet.length)];
    }
  }
  return result;
}

/**
 * 배열 또는 문자열을 무작위로 섞음 (Fisher-Yates Shuffle)
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 문자열의 조건 충족 여부 검사
 */
export function checkPasswordComplexity(password) {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+~|}{[\]:;?><,./\-=]/.test(password);
  
  return {
    hasUpper,
    hasLower,
    hasNumber,
    hasSpecial,
    isValid: hasUpper && hasLower && hasNumber && hasSpecial && password.length >= 8
  };
}

/**
 * 키워드를 기반으로 알파벳 대/소문자, 숫자, 특수문자를 모두 포함하는 패스워드 생성
 * @param {Object} options
 * @param {string} options.keyword - 포함할 기본 키워드 (예: 'Mobis', 'DT001' 등)
 * @param {number} options.targetLength - 목표 전체 패스워드 길이 (기본값: 14)
 * @param {string} options.keywordPlacement - 키워드 위치 ('prefix' | 'suffix' | 'middle' | 'embed') 기본값: 'prefix'
 * @returns {string} 생성된 안전한 패스워드
 */
export function generateSecurePassword({
  keyword = '',
  targetLength = 14,
  keywordPlacement = 'prefix'
} = {}) {
  const cleanKeyword = String(keyword || '').trim();
  
  // 키워드 내에 이미 존재하는 문자군 확인
  const hasUpper = /[A-Z]/.test(cleanKeyword);
  const hasLower = /[a-z]/.test(cleanKeyword);
  const hasNumber = /[0-9]/.test(cleanKeyword);
  const hasSpecial = /[!@#$%^&*()_+~|}{[\]:;?><,./\-=]/.test(cleanKeyword);

  // 반드시 추가되어야 하는 필수 문자들 수집
  const requiredChars = [];
  if (!hasUpper) requiredChars.push(getRandomChars(UPPERCASE, 1));
  if (!hasLower) requiredChars.push(getRandomChars(LOWERCASE, 1));
  if (!hasNumber) requiredChars.push(getRandomChars(NUMBERS, 1));
  if (!hasSpecial) requiredChars.push(getRandomChars(SPECIALS, 1));

  // 키워드가 이미 모든 조건을 만족하더라도, 보안 강도를 위해 최소 특수문자 1개와 숫자 1개 이상 추가
  if (requiredChars.length === 0) {
    requiredChars.push(getRandomChars(SPECIALS, 1));
    requiredChars.push(getRandomChars(NUMBERS, 1));
  }

  // 남은 길이만큼 ALL_CHARS에서 무작위로 채움
  const currentLen = cleanKeyword.length + requiredChars.length;
  const minTarget = Math.max(targetLength, cleanKeyword.length + requiredChars.length, 12);
  const fillCount = Math.max(0, minTarget - currentLen);
  const extraChars = getRandomChars(ALL_CHARS, fillCount);

  // 필수 문자들과 추가 랜덤 문자들을 섞음
  const randomPortion = shuffle([...requiredChars, ...extraChars]).join('');

  let finalPassword = '';

  if (!cleanKeyword) {
    // 키워드가 없는 경우: 대문자, 소문자, 숫자, 특수문자 각 1개 이상 무조건 확보 후 섞음
    const base = [
      getRandomChars(UPPERCASE, 1),
      getRandomChars(LOWERCASE, 1),
      getRandomChars(NUMBERS, 1),
      getRandomChars(SPECIALS, 1),
      ...getRandomChars(ALL_CHARS, Math.max(0, targetLength - 4))
    ];
    finalPassword = shuffle(base).join('');
  } else {
    // 키워드가 있는 경우
    if (keywordPlacement === 'prefix') {
      // Keyword + RandomPortion
      finalPassword = `${cleanKeyword}${randomPortion}`;
    } else if (keywordPlacement === 'suffix') {
      // RandomPortion + Keyword
      finalPassword = `${randomPortion}${cleanKeyword}`;
    } else if (keywordPlacement === 'middle') {
      // RandomFront + Keyword + RandomBack
      const splitIdx = Math.floor(randomPortion.length / 2);
      const front = randomPortion.slice(0, splitIdx);
      const back = randomPortion.slice(splitIdx);
      finalPassword = `${front}${cleanKeyword}${back}`;
    } else {
      // Default: Prefix
      finalPassword = `${cleanKeyword}${randomPortion}`;
    }
  }

  // 최종 점검: 혹시라도 4가지 조건 중 누락된 것이 있다면 강제 보충
  const finalCheck = checkPasswordComplexity(finalPassword);
  if (!finalCheck.hasUpper) finalPassword += getRandomChars(UPPERCASE, 1);
  if (!finalCheck.hasLower) finalPassword += getRandomChars(LOWERCASE, 1);
  if (!finalCheck.hasNumber) finalPassword += getRandomChars(NUMBERS, 1);
  if (!finalCheck.hasSpecial) finalPassword += getRandomChars(SPECIALS, 1);

  return finalPassword;
}
