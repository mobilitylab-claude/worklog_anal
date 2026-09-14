import crypto from 'crypto';

// 암호화 키 생성 (환경변수 또는 고정 마스터 솔트 기반 32바이트 키)
const MASTER_SECRET = process.env.JIRA_ENCRYPTION_KEY || 'jira_worklog_studio_master_secret_2026_selvas_ai';
const KEY = crypto.createHash('sha256').update(MASTER_SECRET).digest();
const ALGORITHM = 'aes-256-gcm';

/**
 * 텍스트 암호화 (AES-256-GCM)
 * @param {string} text - 평문 텍스트 (Jira PAT 등)
 * @returns {string} iv:authTag:encryptedData 포맷의 16진수 문자열
 */
export function encryptText(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 텍스트 복호화 (AES-256-GCM)
 * @param {string} encryptedStr - iv:authTag:encryptedData 포맷의 문자열
 * @returns {string} 복호화된 평문 텍스트
 */
export function decryptText(encryptedStr) {
  if (!encryptedStr) return '';
  try {
    const parts = encryptedStr.split(':');
    if (parts.length !== 3) {
      // 기존 평문 데이터 호환
      return encryptedStr;
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('복호화 오류:', err.message);
    return '';
  }
}

/**
 * 토큰 마스킹 (UI 표시용: 앞 4자리 + *** + 끝 3자리)
 */
export function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '****';
  return `${token.substring(0, 4)}***${token.substring(token.length - 3)}`;
}
