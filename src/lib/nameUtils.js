/**
 * 사용자 이름에서 접미사(예: "기타모비스온사용자", "R&D 협력사", "R&D협력사", "협력사" 등)를 제거하여
 * 순수 이름으로 정규화합니다.
 * 
 * 예:
 * - "탄보련 기타모비스온사용자" -> "탄보련"
 * - "탄보련(기타모비스온사용자)" -> "탄보련"
 * - "아라 R&D 협력사" -> "아라"
 * - "아라(R&D 협력사)" -> "아라"
 * - "김철수 R&D협력사" -> "김철수"
 * 
 * @param {string} name 
 * @returns {string} 정규화된 순수 이름
 */
export function normalizeAuthorName(name) {
  if (!name || typeof name !== 'string') return '';
  let cleaned = name.trim();
  
  // 1. 괄호로 둘러싸인 접미사 패턴 제거: (기타모비스온사용자), [R&D 협력사], (협력사) 등
  cleaned = cleaned.replace(/[\(\[\{]\s*(?:기타모비스온사용자|R&D\s*협력사|R&D협력사|기타모비스온|협력사)\s*[\)\]\}]/gi, '');
  
  // 2. 공백 뒤에 붙은 접미사 제거: " 홍길동 기타모비스온사용자", " 아라 R&D 협력사"
  cleaned = cleaned.replace(/\s+(?:기타모비스온사용자|R&D\s*협력사|R&D협력사|기타모비스온|협력사)\b/gi, '');
  
  // 3. 문자열 끝에 붙은 접미사 제거 (공백 없는 경우 포함)
  cleaned = cleaned.replace(/(?:기타모비스온사용자|R&D\s*협력사|R&D협력사|기타모비스온|협력사)$/gi, '');
  
  return cleaned.trim();
}
