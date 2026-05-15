import { useState, useEffect, useRef } from 'react'
import './App.css'

function App() {
  const [logs, setLogs] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('noti_logs');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  })
  const [userStats, setUserStats] = useState<Record<string, number>>({})
  const [userDetails, setUserDetails] = useState<Record<string, any[]>>({})
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [serverIp, setServerIp] = useState('http://192.168.105.10:3000')
  const [isConnected, setIsConnected] = useState(false)
  const [leftWidth, setLeftWidth] = useState(50)
  const esRef = useRef<EventSource | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = leftWidth;
    const containerWidth = window.innerWidth - 40; // 20px padding * 2
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      let newWidth = startWidth + deltaPercent;
      
      // 최소 20%, 최대 80%로 제한
      if (newWidth < 20) newWidth = 20;
      if (newWidth > 80) newWidth = 80;
      
      setLeftWidth(newWidth);
    };
    
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

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

  const showMainWindow = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.unminimize();
      await appWindow.setFocus();
    } catch (e) {
      console.log('Tauri API not available:', e);
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
            if (resData.success) {
              if (resData.stats) setUserStats(resData.stats)
              if (resData.details) setUserDetails(resData.details)
              
              if (resData.loadingLogs) {
                const logsToAdd = resData.loadingLogs.map((msg: string, idx: number) => ({
                  id: `load-${Date.now()}-${idx}`,
                  receiveTime: new Date().toLocaleTimeString(),
                  isRead: true,
                  type: 'info',
                  title: '초기 로딩 단계',
                  message: msg
                }));
                // 최신 로그가 위로 오도록 역순으로 추가
                setLogs(prev => [...logsToAdd.reverse(), ...prev]);
              }
            } else {
              setLogs(prev => [{ ...baseLog, type: 'error', title: '초기 로딩 실패', message: `서버 에러: ${resData.error || '알 수 없음'}` }, ...prev])
            }
          })
          .catch(err => {
            console.error("초기 통계 데이터 로드 실패:", err);
            setLogs(prev => [{ ...baseLog, type: 'error', title: '초기 로딩 실패', message: `서버 연결 실패: ${err.message}` }, ...prev])
          })
      } else {
        // 모든 실제 알림에 대해 소리 재생 (작업기록 누적 업데이트 제외)
        if (data.notiType === 'USER_WORKLOG') {
          setUserStats(prev => ({
            ...prev,
            [data.title]: parseFloat(data.accumulatedHours || "0")
          }))
          
          // 실시간 작업기록 상세 추가
          if (data.message) {
            const match = data.message.match(/\[(.*?)\] (.*?)h 작업기록 등록/);
            if (match) {
              const issueKey = match[1];
              const hours = parseFloat(match[2]);
              setUserDetails(prev => {
                const userLogs = prev[data.title] || [];
                // 간단한 중복 체크
                const isDuplicate = userLogs.some((l: any) => l.issueKey === issueKey && l.hours === hours);
                if (isDuplicate) return prev;
                
                return {
                  ...prev,
                  [data.title]: [
                    ...userLogs,
                    { issueKey, hours, comment: '실시간 등록됨', time: new Date().toISOString() }
                  ]
                };
              });
            }
          }
        } else if (data.notiType === 'ALL_USER_STATS') {
          if (data.stats) {
            setUserStats(prev => {
              const isChanged = Object.keys(data.stats).some(k => data.stats[k] !== prev[k]);
              if (isChanged) return data.stats;
              return prev;
            });
          }
          if (data.details) {
            setUserDetails(data.details);
          }
        } else {
          playSound()
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(data.title || "JIRA 알림", { body: data.message })
          }
          // 창 띄우기 (알림 발생 시)
          showMainWindow()
          // 에러/경고성 알림만 로그 리스트에 추가
          setLogs(prev => [{ ...data, ...baseLog }, ...prev])
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

  // 앱 실행 시 자동 연결 시도
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
    
    // 자동 접속
    if (!isConnected && !esRef.current) {
      connectSSE();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 로그가 변경될 때마다 localStorage에 저장
  useEffect(() => {
    localStorage.setItem('noti_logs', JSON.stringify(logs));
  }, [logs]);

  // 페이지 로딩 후 경과 시간 타이머
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    
    // 8시간 기준 5단계 파스텔톤 색상 구분
    let color = '#bbf7d0'; // 기본: 기준 달성 (7.5h ~ 8.5h) - 파스텔 녹색
    
    if (hours < 4) {
      color = '#dc2626'; // 1단계: 매우 미달 (0h ~ 4h) - Vivid Red
    } else if (hours < 7.5) {
      color = '#f97316'; // 2단계: 미달 (4h ~ 7.5h) - Vivid Orange
    } else if (hours <= 8.5) {
      color = '#16a34a'; // 3단계: 기준 (7.5h ~ 8.5h) - Vivid Green
    } else if (hours <= 10) {
      color = '#a3e635'; // 4단계: 초과 (8.5h ~ 10h) - Lime (연두색/중간색)
    } else {
      color = '#facc15'; // 5단계: 매우 초과 (10h 이상) - Vivid Yellow
    }
    
    const conic = `conic-gradient(${color} ${pct}%, #334155 0)`;
    
    return (
      <div style={{ position: 'relative', width: '48px', height: '48px', minWidth: '48px', minHeight: '48px', flexShrink: 0, borderRadius: '50%', background: conic, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: '38px', height: '38px', borderRadius: '50%', background: '#1e293b' }}></div>
        <span style={{ position: 'relative', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff' }}>{hours}h</span>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#0f172a', color: '#e2e8f0' }}>
      {/* 상단 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '5px' }}>
            <h2 style={{ color: '#60a5fa', margin: 0 }}>🔔 JIRA 백그라운드 알림 클라이언트</h2>
            <div style={{ 
              fontFamily: 'monospace', 
              background: '#0f172a', 
              color: '#10b981', 
              padding: '4px 10px', 
              borderRadius: '6px', 
              border: '2px solid #10b981',
              boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)',
              fontWeight: 'bold', 
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              ⏱️ {formatTime(elapsedTime)}
            </div>
          </div>
          <p style={{ color: '#888', fontSize: '0.9rem', margin: 0 }}>
            웹앱 서버와 연결하여 실시간으로 알림을 수신합니다. (최소화 시 트레이 숨김)
          </p>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', minWidth: '300px' }}>
          <input 
            type="text" 
            value={serverIp} 
            onChange={(e) => setServerIp(e.target.value)} 
            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: 'white' }}
          />
          <button 
            onClick={isConnected ? disconnectSSE : connectSSE} 
            style={{ padding: '8px 16px', borderRadius: '4px', background: isConnected ? '#ef4444' : '#3b82f6', color: 'white', border: 'none', cursor: 'pointer', minWidth: '100px', fontWeight: 'bold' }}
          >
            {isConnected ? '연결 끊기' : '서버 연결'}
          </button>
        </div>
      </div>

      {/* 상단: 작업자별 누적 시간 (가로 그리드) */}
      <div style={{ background: '#1e293b', padding: '15px', borderRadius: '8px', border: '1px solid #334155', marginBottom: '15px' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#94a3b8', fontSize: '0.95rem' }}>👥 작업자별 누적 시간 (Today) - 클릭 시 상세 보기</h4>
        {Object.keys(userStats).length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
            {Object.entries(userStats).map(([name, hours]) => {
              // 해당 작업자의 미확인 위반 알림이 있는지 확인
              const hasUnreadAlert = logs.some(log => 
                !log.isRead && 
                ['INVALID_PROJECT', 'INVALID_TASK_TYPE', 'TIME_EXCEEDED'].includes(log.notiType) &&
                (log.author === name || log.author?.includes(name))
              );

              return (
                <div 
                  key={name} 
                  onClick={() => setSelectedUser(name)}
                  style={{ 
                    background: selectedUser === name ? '#334155' : '#0f172a', 
                    padding: '8px', 
                    borderRadius: '6px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '10px', 
                    border: selectedUser === name ? '2px solid #3b82f6' : '1px solid #334155',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    position: 'relative'
                  }}
                >
                  {hasUnreadAlert && (
                    <span style={{ 
                      position: 'absolute', 
                      top: '-5px', 
                      right: '-5px', 
                      background: '#ef4444', 
                      color: 'white', 
                      borderRadius: '50%', 
                      width: '18px', 
                      height: '18px', 
                      fontSize: '0.7rem', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      fontWeight: 'bold',
                      boxShadow: '0 0 5px rgba(239, 68, 68, 0.5)'
                    }}>
                      !
                    </span>
                  )}
                  {renderDonut(hours)}
                  <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#cbd5e1' }}>{name}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ color: '#555', fontSize: '0.9rem' }}>
            {isConnected ? '작업자 정보 없음' : '서버 연결 후 대기 중입니다...'}
          </div>
        )}
      </div>

      {/* 하단: 좌(실시간 로그) / 우(작업 내용 상세) */}
      <div style={{ display: 'flex', flex: 1, gap: '0px', overflow: 'hidden' }}>
        
        {/* 하단 좌측: 실시간 위반 알림 로그 */}
        <div style={{ flex: `0 0 ${leftWidth}%`, background: '#1e293b', padding: '15px', borderRadius: '8px 0 0 8px', border: '1px solid #334155', borderRight: 'none', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
            <h4 style={{ margin: 0, color: '#aaa', fontSize: '0.95rem' }}>
              🚨 실시간 위반 알림 로그
              <span style={{ fontSize: '0.8rem', marginLeft: '10px', color: '#888', fontWeight: 'normal' }}>
                (미확인: <span style={{ color: unreadCount > 0 ? '#f87171' : '#888', fontWeight: 'bold' }}>{unreadCount}</span> / 확인: {readCount})
              </span>
            </h4>
            <button 
              onClick={() => setLogs(prev => prev.filter(log => !log.isRead))}
              style={{ padding: '4px 10px', background: '#334155', color: '#ccc', border: '1px solid #475569', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
              title="확인된 알림만 지웁니다."
            >
              🧹 비우기
            </button>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {logs.length === 0 && <p style={{ color: '#555', textAlign: 'center', marginTop: '30px', fontSize: '0.9rem' }}>현재 기록된 알림 로그가 없습니다.</p>}
            {logs.map((log, index) => renderLogCard(log, index))}
          </div>
        </div>

        {/* 구분선 (드래그 핸들) */}
        <div 
          onMouseDown={handleMouseDown}
          style={{ 
            width: '6px', 
            cursor: 'col-resize', 
            background: '#334155', 
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }} 
        >
          <div style={{ width: '2px', height: '20px', background: '#475569', borderRadius: '1px' }}></div>
        </div>

        {/* 하단 우측: 작업 내용 상세 */}
        <div style={{ flex: '1 1 auto', background: '#1e293b', padding: '15px', borderRadius: '0 8px 8px 0', border: '1px solid #334155', borderLeft: 'none', display: 'flex', flexDirection: 'column', overflowY: 'hidden' }}>
          <div style={{ marginBottom: '10px', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>
            <h4 style={{ margin: 0, color: '#aaa', fontSize: '0.95rem' }}>
              📝 작업 기록 상세 {selectedUser ? `(${selectedUser})` : ''}
            </h4>
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!selectedUser ? (
              <p style={{ color: '#555', textAlign: 'center', marginTop: '30px', fontSize: '0.9rem' }}>상단의 작업자를 선택하면 오늘 작성한 작업 기록 목록을 볼 수 있습니다.</p>
            ) : (userDetails[selectedUser] || []).length === 0 ? (
              <p style={{ color: '#555', textAlign: 'center', marginTop: '30px', fontSize: '0.9rem' }}>오늘 기록된 작업 내용이 없습니다.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(userDetails[selectedUser] || []).map((detail, idx) => (
                  <div key={idx} style={{ background: '#0f172a', padding: '10px', borderRadius: '6px', border: '1px solid #334155' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '0.85rem' }}>{detail.issueKey}</span>
                      <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.85rem' }}>{detail.hours}h</span>
                    </div>
                    {/* 이슈 제목 추가 */}
                    {detail.summary && (
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', fontWeight: 'bold', marginBottom: '5px', background: '#1e293b', padding: '4px 6px', borderRadius: '4px' }}>
                        📌 {detail.summary}
                      </div>
                    )}
                    {/* 작업 내용 (댓글) */}
                    {detail.comment && (
                      <div style={{ color: '#cbd5e1', fontSize: '0.85rem', wordBreak: 'break-all', paddingLeft: '4px', whiteSpace: 'pre-wrap' }}>
                        💬 {detail.comment}
                      </div>
                    )}
                    <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: '5px', textAlign: 'right' }}>
                      {detail.time ? new Date(detail.time).toLocaleTimeString() : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}

export default App
