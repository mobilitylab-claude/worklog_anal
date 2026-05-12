import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [logs, setLogs] = useState<any[]>([])
  const [userStats, setUserStats] = useState<Record<string, number>>({})
  const [serverIp, setServerIp] = useState('http://192.168.105.10:3000')
  const [isConnected, setIsConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }, [])

  // 알림음 재생 함수
  const playSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const oscillator = audioCtx.createOscillator()
      const gainNode = audioCtx.createGain()
      
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime) // A5 note
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1) // Drop to A4
      
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1)
      
      oscillator.connect(gainNode)
      gainNode.connect(audioCtx.destination)
      
      oscillator.start()
      oscillator.stop(audioCtx.currentTime + 0.15)
    } catch (e) {
      console.error("Audio play failed", e)
    }
  }

  const connectSSE = () => {
    if (isConnected) return;
    
    setLogs(prev => [{ type: 'info', msg: `[${new Date().toLocaleTimeString()}] 연결 시도 중... ${serverIp}` }, ...prev])
    const eventSource = new EventSource(`${serverIp}/api/notifications/stream`)
    esRef.current = eventSource;

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      const baseLog = { id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false };
      
      if (data.type === 'connected') {
        setLogs(prev => [{ ...baseLog, type: 'success', msg: `[${baseLog.receiveTime}] ✅ 서버 연결 완료: ${data.message}` }, ...prev])
        setIsConnected(true)

        // 연결 완료 시, 즉시 모니터링 대상자들의 오늘 누적 시간 현황을 가져와 화면(도넛 차트)에 모두 표시
        fetch(`${serverIp}/api/notifications/initial-stats`)
          .then(res => res.json())
          .then(resData => {
            if (resData.success && resData.stats) {
              setUserStats(resData.stats)
            }
          })
          .catch(err => console.error("초기 통계 데이터 로드 실패:", err))
      } else {
        // 모든 실제 알림에 대해 소리 재생 (작업기록 누적 업데이트 제외)
        if (data.notiType !== 'USER_WORKLOG') {
          playSound()
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(data.title || "JIRA 알림", { body: data.message })
          }
          // 에러/경고성 알림만 로그 리스트에 추가
          setLogs(prev => [{ ...data, ...baseLog }, ...prev])
        } else {
          // USER_WORKLOG 타입은 사용자 작업시간 통계로만 업데이트
          setUserStats(prev => ({
            ...prev,
            [data.title]: parseFloat(data.accumulatedHours || "0")
          }))
        }
      }
    }

    eventSource.onerror = (err) => {
      setLogs(prev => [{ id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false, type: 'error', msg: `[${new Date().toLocaleTimeString()}] ❌ SSE 연결 오류. 네트워크 문제일 경우 자동 재접속을 시도합니다...` }, ...prev])
      setIsConnected(false)
      // 네이티브 자동 재접속을 지원하기 위해 여기서는 close()를 호출하지 않습니다.
    }
  }

  const disconnectSSE = () => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setIsConnected(false)
    setLogs(prev => [{ id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false, type: 'info', msg: `[${new Date().toLocaleTimeString()}] 🔌 서버와의 연결을 수동으로 해제했습니다.` }, ...prev])
  }

  const markAsRead = (id: number) => {
    setLogs(prev => prev.map(log => log.id === id ? { ...log, isRead: true } : log))
  }

  // 카드 렌더링 함수
  const renderLogCard = (log: any, index: number) => {
    // 1. 일반 정보 로그
    if (log.type === 'info' || log.type === 'success' || log.type === 'error') {
      const color = log.type === 'error' ? '#fca5a5' : log.type === 'success' ? '#86efac' : '#ddd'
      return <div key={log.id || index} style={{ marginBottom: '8px', fontSize: '0.85rem', color }}>{log.msg}</div>
    }

    // 2. 미등록 프로젝트 / 3. 미정의 작업유형 / 4. 예상시간 초과
    const isAlert = ['INVALID_PROJECT', 'INVALID_TASK_TYPE', 'TIME_EXCEEDED'].includes(log.notiType);
    if (isAlert) {
      let borderColor = '#f59e0b'; // 경고 (노란색)
      if (log.notiType === 'INVALID_PROJECT') borderColor = '#ef4444'; // 위험 (빨간색)
      
      const isRead = log.isRead;
      const opacity = isRead ? 0.5 : 1;
      const bg = isRead ? '#2a2a2a' : '#3f1d1d';
      const bColor = isRead ? '#555' : borderColor;

      return (
        <div key={log.id || index} style={{ position: 'relative', opacity, background: bg, padding: '12px', borderRadius: '6px', marginBottom: '10px', borderLeft: `4px solid ${bColor}`, transition: 'all 0.3s' }}>
          <div style={{ fontSize: '0.8rem', color: isRead ? '#888' : '#fca5a5', marginBottom: '4px' }}>{log.receiveTime} - 🚨 {log.notiType}</div>
          <div style={{ fontWeight: 'bold', color: isRead ? '#aaa' : '#f87171' }}>{log.title}</div>
          <div style={{ color: isRead ? '#777' : '#fca5a5', fontSize: '0.9rem', margin: '4px 0' }}>{log.message}</div>
          
          <div style={{ fontSize: '0.8rem', color: isRead ? '#666' : '#cbd5e1', marginTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {log.issueKey && <span>🔑 {log.issueKey}</span>}
            {log.author && <span>👤 {log.author}</span>}
            {log.time && <span>⏱️ {log.time}</span>}
          </div>
          {log.url && (
            <a href={log.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '8px', fontSize: '0.8rem', color: isRead ? '#555' : '#60a5fa', textDecoration: 'none' }}>
              🔗 JIRA에서 확인하기
            </a>
          )}
          
          {/* 확인 버튼 및 상태 */}
          {!isRead ? (
            <button 
              onClick={() => markAsRead(log.id)}
              style={{ position: 'absolute', top: '12px', right: '12px', padding: '4px 10px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}
            >
              알람 확인
            </button>
          ) : (
            <span style={{ position: 'absolute', top: '12px', right: '12px', fontSize: '0.75rem', color: '#888' }}>
              ✓ 확인됨
            </span>
          )}
        </div>
      )
    }

    // 기본 (이전 버전 호환용)
    const isRead = log.isRead;
    return (
      <div key={log.id || index} style={{ position: 'relative', opacity: isRead ? 0.5 : 1, background: '#222', padding: '10px', borderRadius: '6px', marginBottom: '10px' }}>
        <div style={{ fontSize: '0.8rem', color: '#888' }}>{log.receiveTime}</div>
        <div style={{ fontWeight: 'bold', color: isRead ? '#777' : '#fff' }}>🔔 {log.title}</div>
        <div style={{ color: isRead ? '#666' : '#ccc', fontSize: '0.9rem' }}>{log.message}</div>
        
        {log.notiType && !isRead && (
          <button 
            onClick={() => markAsRead(log.id)}
            style={{ position: 'absolute', top: '10px', right: '10px', padding: '4px 8px', background: '#444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
          >
            확인
          </button>
        )}
      </div>
    )
  }

  // 통계 계산
  const alertLogs = logs.filter(log => log.notiType && log.notiType !== 'USER_WORKLOG');
  const unreadCount = alertLogs.filter(log => !log.isRead).length;
  const readCount = alertLogs.filter(log => log.isRead).length;

  // 도넛 차트 렌더링 헬퍼
  const renderDonut = (hours: number) => {
    const max = 8;
    const pct = Math.min((hours / max) * 100, 100);
    const color = pct >= 100 ? '#10b981' : '#3b82f6';
    const conic = `conic-gradient(${color} ${pct}%, #334155 0)`;
    
    return (
      <div style={{ position: 'relative', width: '48px', height: '48px', borderRadius: '50%', background: conic, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: '38px', height: '38px', borderRadius: '50%', background: '#1e293b' }}></div>
        <span style={{ position: 'relative', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff' }}>{hours}h</span>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <h2 style={{ color: '#60a5fa', margin: '0 0 5px 0' }}>🔔 JIRA 백그라운드 알림 클라이언트</h2>
      <p style={{ color: '#888', fontSize: '0.9rem', margin: '0 0 15px 0' }}>웹앱 서버와 연결하여 실시간으로 알림을 수신합니다. (항상 위 고정됨)</p>
      
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
        <input 
          type="text" 
          value={serverIp} 
          onChange={(e) => setServerIp(e.target.value)} 
          style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: 'white' }}
        />
        <button 
          onClick={isConnected ? disconnectSSE : connectSSE} 
          style={{ padding: '8px 16px', borderRadius: '4px', background: isConnected ? '#ef4444' : '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', minWidth: '100px' }}
        >
          {isConnected ? '연결 끊기' : '서버 연결'}
        </button>
      </div>

      {Object.keys(userStats).length > 0 && (
        <div style={{ marginBottom: '15px', background: '#111', padding: '15px', borderRadius: '8px', border: '1px solid #333' }}>
          <h4 style={{ margin: '0 0 10px 0', color: '#94a3b8', fontSize: '0.85rem' }}>👥 작업자별 누적 시간 (Today)</h4>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {Object.entries(userStats).map(([name, hours]) => (
              <div key={name} style={{ background: '#1e293b', padding: '8px 12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid #334155' }}>
                {renderDonut(hours)}
                <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#cbd5e1' }}>{name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, background: '#111', padding: '15px', borderRadius: '8px', overflowY: 'auto', border: '1px solid #333', textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
          <h4 style={{ margin: 0, color: '#aaa' }}>
            🚨 실시간 위반 알림 로그
            <span style={{ fontSize: '0.85rem', marginLeft: '10px', color: '#888', fontWeight: 'normal' }}>
              (미확인: <span style={{ color: unreadCount > 0 ? '#f87171' : '#888', fontWeight: 'bold' }}>{unreadCount}</span> / 확인: {readCount} / 전체: {alertLogs.length})
            </span>
          </h4>
          <button 
            onClick={() => setLogs([])}
            style={{ padding: '6px 12px', background: '#2a2a2a', color: '#ccc', border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            🧹 로그 전체 지우기
          </button>
        </div>
        
        {logs.length === 0 && <p style={{ color: '#555', textAlign: 'center', marginTop: '50px' }}>서버 연결 후 대기 중입니다... (현재 기록된 로그 없음)</p>}
        {logs.map((log, index) => renderLogCard(log, index))}
      </div>
    </div>
  )
}

export default App
