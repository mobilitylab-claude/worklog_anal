import db from '@/lib/db';
import { decryptText } from '@/lib/crypto';

/**
 * 현재 활성화된 Jira 계정의 복호화된 PAT 토큰을 가져옵니다.
 * 1. 클라이언트 헤더(x-jira-token)에 명시된 토큰이 있으면 최우선 적용
 * 2. 없으면 DB(jira_accounts)에서 활성화된(is_active=1) 계정의 토큰을 복호화하여 적용
 * 3. 없으면 환경변수(JIRA_API_TOKEN) 적용
 *
 * @param {string|null} customToken - 클라이언트 요청 헤더의 x-jira-token 등
 * @returns {string} 유효한 Jira API 토큰
 */
export function getActiveJiraToken(customToken = null) {
  if (customToken && typeof customToken === 'string' && customToken.trim()) {
    return customToken.trim();
  }

  try {
    const activeRow = db.prepare('SELECT encrypted_token FROM jira_accounts WHERE is_active = 1 LIMIT 1').get();
    if (activeRow && activeRow.encrypted_token) {
      const decrypted = decryptText(activeRow.encrypted_token);
      if (decrypted) return decrypted;
    }

    // 활성 설정이 누락된 경우 가장 최근 계정 fallback
    const firstRow = db.prepare('SELECT encrypted_token FROM jira_accounts ORDER BY updated_at DESC LIMIT 1').get();
    if (firstRow && firstRow.encrypted_token) {
      const decrypted = decryptText(firstRow.encrypted_token);
      if (decrypted) return decrypted;
    }
  } catch (err) {
    console.error('getActiveJiraToken DB 조회 실패:', err);
  }

  return process.env.JIRA_API_TOKEN || '';
}
