import { useState, useEffect, useRef } from 'react'
import './App.css'

type ViewMode = 'dashboard' | 'monitor' | 'tunnel';

function App() {
  // ── 네비게이션 및 뷰 상태 ──
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard')
  const [currentDashboardPath, setCurrentDashboardPath] = useState('/')
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false)
  
  // ── 실시간 모니터링 상태 ──
  const [logs, setLogs] = useState<any[]>(() => {
    try {
      const saved = sessionStorage.getItem('noti_logs');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  })
  const [userStats, setUserStats] = useState<Record<string, number>>({})
  const [userDetails, setUserDetails] = useState<Record<string, any[]>>({})
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [serverIp, setServerIp] = useState(() => {
    return localStorage.getItem('jira_server_url') || 'http://localhost:3000';
  })
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [leftWidth, setLeftWidth] = useState(50)
  const esRef = useRef<EventSource | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [elapsedTime, setElapsedTime] = useState(0)

  // 서버 URL 저장
  useEffect(() => {
    localStorage.setItem('jira_server_url', serverIp);
  }, [serverIp]);

  // 창 항상 위 고정 토글
  const toggleAlwaysOnTop = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const nextState = !isAlwaysOnTop;
      await win.setAlwaysOnTop(nextState);
      setIsAlwaysOnTop(nextState);
    } catch (e) {
      console.warn('Always on top toggle failed:', e);
    }
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = leftWidth;
    const containerWidth = window.innerWidth - 40;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      let newWidth = startWidth + deltaPercent;
      
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
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime)
      oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1)
      
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
      
      const isVisible = await appWindow.isVisible();
      const isMinimized = await appWindow.isMinimized();
      
      if (isMinimized) {
        await appWindow.unminimize();
      }
      if (!isVisible) {
        await appWindow.show();
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
      await appWindow.setFocus();
    } catch (e) {
      console.log('Tauri API not available:', e);
    }
  }

  const connectSSE = () => {
    if (isConnected || isConnecting) return;
    setIsConnecting(true);
    
    const targetUrl = serverIp.replace(/\/$/, '');
    setLogs(prev => [{ type: 'info', msg: `[${new Date().toLocaleTimeString()}] 연결 시도 중... ${targetUrl}` }, ...prev])
    
    try {
      const eventSource = new EventSource(`${targetUrl}/api/notifications/stream`)
      esRef.current = eventSource;

      eventSource.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
      };

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data)
        const baseLog = { id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false };
        
        if (data.type === 'connected') {
          setLogs(prev => [{ ...baseLog, type: 'success', msg: `[${baseLog.receiveTime}] ✅ 백엔드 연결 완료: ${data.message}` }, ...prev])
          setIsConnected(true)
          setIsConnecting(false)

          fetch(`${targetUrl}/api/notifications/initial-stats`)
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
                  setLogs(prev => [...logsToAdd.reverse(), ...prev]);
                }
              }
            })
            .catch(err => {
              console.error("초기 통계 데이터 로드 실패:", err);
            })
        } else {
          if (data.notiType === 'USER_WORKLOG') {
            setUserStats(prev => ({
              ...prev,
              [data.title]: parseFloat(data.accumulatedHours || "0")
            }))
            
            if (data.message) {
              const match = data.message.match(/\[(.*?)\] (.*?)h 작업기록 등록/);
              if (match) {
                const issueKey = match[1];
                const hours = parseFloat(match[2]);
                setUserDetails(prev => {
                  const userLogs = prev[data.title] || [];
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
            showMainWindow()
            setLogs(prev => [{ ...data, ...baseLog }, ...prev])
          }
        }
      }

      eventSource.onerror = () => {
        setIsConnected(false);
        setIsConnecting(false);
        setLogs(prev => [{ id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false, type: 'error', msg: `[${new Date().toLocaleTimeString()}] ❌ SSE 연결 끊김/재시도 중...` }, ...prev])
      }
    } catch (err: any) {
      setIsConnected(false);
      setIsConnecting(false);
      setLogs(prev => [{ id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false, type: 'error', msg: `[${new Date().toLocaleTimeString()}] ❌ 연결 에러: ${err.message}` }, ...prev])
    }
  }

  const disconnectSSE = () => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    setIsConnected(false)
    setIsConnecting(false)
    setLogs(prev => [{ type: 'info', msg: `[${new Date().toLocaleTimeString()}] 🔌 연결 해제됨` }, ...prev])
  }

  // 앱 시작 시 자동 연결
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    connectSSE();
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    }
  }, [])

  // 타이머
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 로그 저장
  useEffect(() => {
    try {
      sessionStorage.setItem('noti_logs', JSON.stringify(logs.slice(0, 100)));
    } catch (e) {}
  }, [logs]);

  const markAsRead = (id: any) => {
    setLogs(prev => prev.map(log => log.id === id ? { ...log, isRead: true } : log))
  }

  const markAllAsRead = () => {
    setLogs(prev => prev.map(log => ({ ...log, isRead: true })))
  }

  const clearLogs = () => {
    setLogs([])
    sessionStorage.removeItem('noti_logs')
  }

  // 대시보드 퀵 네비게이션
  const navigateDashboard = (path: string) => {
    setCurrentDashboardPath(path);
    if (iframeRef.current) {
      const targetBase = serverIp.replace(/\/$/, '');
      iframeRef.current.src = `${targetBase}${path}`;
    }
  };

  const refreshDashboard = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  // 통계 계산
  const alertLogs = logs.filter(log => log.notiType && log.notiType !== 'USER_WORKLOG');
  const unreadCount = alertLogs.filter(log => !log.isRead).length;

  const renderDonut = (hours: number) => {
    const max = 8;
    const pct = Math.min((hours / max) * 100, 100);
    
    let color = '#bbf7d0';
    if (hours < 4) {
      color = '#dc2626';
    } else if (hours < 7.5) {
      color = '#f97316';
    } else if (hours <= 8.5) {
      color = '#16a34a';
    } else if (hours <= 10) {
      color = '#a3e635';
    } else {
      color = '#facc15';
    }
    
    const conic = `conic-gradient(${color} ${pct}%, #334155 0)`;
    
    return (
      <div style={{ position: 'relative', width: '48px', height: '48px', minWidth: '48px', minHeight: '48px', flexShrink: 0, borderRadius: '50%', background: conic, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: '38px', height: '38px', borderRadius: '50%', background: '#1e293b' }}></div>
        <span style={{ position: 'relative', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff' }}>{hours}h</span>
      </div>
    )
  }

  const renderLogItem = (log: any, index: number) => {
    if (log.msg) {
      return (
        <div key={log.id || index} style={{ 
          padding: '8px 12px', 
          borderRadius: '6px', 
          marginBottom: '8px', 
          fontSize: '0.85rem',
          background: log.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : log.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : '#1e293b',
          color: log.type === 'error' ? '#fca5a5' : log.type === 'success' ? '#6ee7b7' : '#94a3b8',
          borderLeft: `4px solid ${log.type === 'error' ? '#ef4444' : log.type === 'success' ? '#10b981' : '#64748b'}`
        }}>
          {log.msg}
        </div>
      )
    }

    if (log.notiType) {
      const isRead = log.isRead;
      let cardBg = '#1e293b';
      let borderLeft = '#3b82f6';
      let icon = '🔔';

      if (log.notiType === 'INVALID_PROJECT') {
        cardBg = isRead ? 'rgba(51, 65, 85, 0.4)' : 'rgba(239, 68, 68, 0.15)';
        borderLeft = '#ef4444';
        icon = '🚨';
      } else if (log.notiType === 'INVALID_TASK_TYPE') {
        cardBg = isRead ? 'rgba(51, 65, 85, 0.4)' : 'rgba(245, 158, 11, 0.15)';
        borderLeft = '#f59e0b';
        icon = '⚠️';
      } else if (log.notiType === 'TIME_EXCEEDED') {
        cardBg = isRead ? 'rgba(51, 65, 85, 0.4)' : 'rgba(236, 72, 153, 0.15)';
        borderLeft = '#ec4899';
        icon = '⏱️';
      }

      return (
        <div key={log.id || index} style={{ 
          position: 'relative', 
          background: cardBg, 
          border: '1px solid #334155', 
          borderLeft: `5px solid ${borderLeft}`, 
          borderRadius: '8px', 
          padding: '12px', 
          marginBottom: '10px',
          boxShadow: isRead ? 'none' : '0 2px 8px rgba(0,0,0,0.3)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{log.receiveTime}</span>
            {!isRead ? (
              <button 
                onClick={() => markAsRead(log.id)}
                style={{ padding: '3px 8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}
              >
                확인
              </button>
            ) : (
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>✓ 확인됨</span>
            )}
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '0.95rem', color: isRead ? '#94a3b8' : '#f8fafc', marginBottom: '6px' }}>
            {icon} {log.title}
          </div>
          <div style={{ fontSize: '0.85rem', color: isRead ? '#64748b' : '#cbd5e1', lineHeight: '1.4' }}>
            {log.message}
          </div>
          {log.comment && (
            <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '0.8rem', color: '#94a3b8' }}>
              <strong>기록 내용:</strong> {log.comment}
            </div>
          )}
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px', display: 'flex', gap: '12px' }}>
            {log.issueKey && <span>🔑 {log.issueKey}</span>}
            {log.author && <span>👤 {log.author}</span>}
          </div>
          {log.url && (
            <a href={log.url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '6px', fontSize: '0.8rem', color: '#60a5fa', textDecoration: 'none' }}>
              🔗 JIRA에서 확인하기
            </a>
          )}
        </div>
      )
    }

    return null;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#0b0f19', color: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden' }}>
      
      {/* ── 최상단 헤더 네비게이션 바 ── */}
      <header style={{ 
        height: '52px', 
        background: '#111827', 
        borderBottom: '1px solid #1f2937', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        padding: '0 16px',
        flexShrink: 0
      }}>
        {/* 좌측 로고 및 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.25rem' }}>🚀</span>
            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#60a5fa', letterSpacing: '-0.3px' }}>
              Jira Worklog Studio
            </span>
          </div>
          <span style={{ 
            fontSize: '0.72rem', 
            padding: '2px 8px', 
            borderRadius: '9999px', 
            background: isConnected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: isConnected ? '#34d399' : '#f87171',
            border: `1px solid ${isConnected ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isConnected ? '#10b981' : '#ef4444' }}></span>
            {isConnected ? '보안 통신 활성' : '연결 끊김'}
          </span>
        </div>

        {/* 중앙 메인 탭 */}
        <div style={{ display: 'flex', gap: '4px', background: '#0b0f19', padding: '3px', borderRadius: '8px', border: '1px solid #1f2937' }}>
          <button 
            onClick={() => setViewMode('dashboard')}
            style={{ 
              padding: '6px 14px', 
              borderRadius: '6px', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: viewMode === 'dashboard' ? '#2563eb' : 'transparent',
              color: viewMode === 'dashboard' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
          >
            <span>📊</span> 업무 대시보드
          </button>

          <button 
            onClick={() => setViewMode('monitor')}
            style={{ 
              padding: '6px 14px', 
              borderRadius: '6px', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: viewMode === 'monitor' ? '#2563eb' : 'transparent',
              color: viewMode === 'monitor' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🔔</span> 실시간 모니터링
            {unreadCount > 0 && (
              <span style={{ 
                background: '#ef4444', 
                color: 'white', 
                borderRadius: '9999px', 
                padding: '1px 6px', 
                fontSize: '0.7rem', 
                fontWeight: 800 
              }}>
                {unreadCount}
              </span>
            )}
          </button>

          <button 
            onClick={() => setViewMode('tunnel')}
            style={{ 
              padding: '6px 14px', 
              borderRadius: '6px', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '0.85rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: viewMode === 'tunnel' ? '#2563eb' : 'transparent',
              color: viewMode === 'tunnel' ? '#ffffff' : '#94a3b8',
              transition: 'all 0.15s ease'
            }}
          >
            <span>🛡️</span> 보안 터널 & 설정
          </button>
        </div>

        {/* 우측 유틸리티 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ 
            fontFamily: 'monospace', 
            background: 'rgba(16, 185, 129, 0.1)', 
            color: '#34d399', 
            padding: '3px 8px', 
            borderRadius: '4px', 
            border: '1px solid rgba(16, 185, 129, 0.3)',
            fontWeight: 600, 
            fontSize: '0.85rem'
          }}>
            ⏱️ {formatTime(elapsedTime)}
          </div>

          <button
            onClick={toggleAlwaysOnTop}
            title="창 항상 위에 고정 토글"
            style={{
              padding: '5px 10px',
              background: isAlwaysOnTop ? '#3b82f6' : '#1f2937',
              color: isAlwaysOnTop ? '#fff' : '#94a3b8',
              border: '1px solid #374151',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600
            }}
          >
            📌 {isAlwaysOnTop ? '고정됨' : '고정'}
          </button>
        </div>
      </header>

      {/* ── 메인 컨텐츠 영역 ── */}
      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

        {/* 1. [업무 대시보드 뷰] */}
        {viewMode === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
            {/* 대시보드 서브 네비게이션 툴바 */}
            <div style={{ 
              height: '42px', 
              background: '#0f172a', 
              borderBottom: '1px solid #1e293b', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              padding: '0 12px' 
            }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: '#64748b', marginRight: '6px', fontWeight: 600 }}>바로가기:</span>
                {[
                  { label: '🏠 홈 대시보드', path: '/' },
                  { label: '📈 프로젝트 입체 모니터링', path: '/project-monitoring' },
                  { label: '⏱️ 워크로그 분석기', path: '/worklog' },
                  { label: '📑 월간 리포트', path: '/monthly-reports' },
                  { label: '👥 팀원 관리', path: '/user-management' },
                  { label: '⚙️ 기준 관리', path: '/standard-management' },
                ].map(item => (
                  <button
                    key={item.path}
                    onClick={() => navigateDashboard(item.path)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      border: currentDashboardPath === item.path ? '1px solid #3b82f6' : '1px solid #334155',
                      background: currentDashboardPath === item.path ? 'rgba(59, 130, 246, 0.2)' : '#1e293b',
                      color: currentDashboardPath === item.path ? '#60a5fa' : '#cbd5e1',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={refreshDashboard}
                  title="새로고침"
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  🔄 화면 새로고침
                </button>
              </div>
            </div>

            {/* 웹앱 임베드 iframe */}
            <iframe
              ref={iframeRef}
              src={`${serverIp.replace(/\/$/, '')}${currentDashboardPath}`}
              style={{
                flex: 1,
                width: '100%',
                border: 'none',
                background: '#0b0f19'
              }}
              title="Jira Analytics Dashboard"
            />
          </div>
        )}

        {/* 2. [실시간 모니터링 뷰] */}
        {viewMode === 'monitor' && (
          <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            {/* 좌측: 작업자별 누적 현황 도넛 차트 */}
            <div style={{ 
              width: `${leftWidth}%`, 
              height: '100%', 
              background: '#0f172a', 
              padding: '16px', 
              boxSizing: 'border-box', 
              overflowY: 'auto',
              borderRight: '1px solid #1e293b'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>👥</span> 팀원별 당일 작업시간 현황
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>카드 클릭 시 상세 워크로그 조회</span>
              </div>

              {Object.keys(userStats).length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: '12px' }}>
                  {Object.entries(userStats).map(([name, hours]) => {
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
                          background: selectedUser === name ? '#1e293b' : '#111827', 
                          border: selectedUser === name ? '2px solid #3b82f6' : hasUnreadAlert ? '1px solid #ef4444' : '1px solid #1f2937', 
                          borderRadius: '8px', 
                          padding: '12px', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          position: 'relative'
                        }}
                      >
                        {hasUnreadAlert && (
                          <span style={{ position: 'absolute', top: '6px', right: '6px', width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }}></span>
                        )}
                        {renderDonut(hours)}
                        <span style={{ marginTop: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', textAlign: 'center' }}>
                          {name}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '40px 0', fontSize: '0.9rem' }}>
                  작업시간 통계 수신 대기 중...
                </div>
              )}

              {/* 선택된 작업자 상세 모달/패널 */}
              {selectedUser && (
                <div style={{ marginTop: '20px', background: '#111827', border: '1px solid #1f2937', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h4 style={{ margin: 0, color: '#60a5fa', fontSize: '0.95rem' }}>
                      📋 {selectedUser} 님의 오늘 작업 내역
                    </h4>
                    <button 
                      onClick={() => setSelectedUser(null)}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem' }}
                    >
                      ✕ 닫기
                    </button>
                  </div>
                  
                  {userDetails[selectedUser] && userDetails[selectedUser].length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                      {userDetails[selectedUser].map((item, idx) => (
                        <div key={idx} style={{ background: '#1e293b', padding: '10px', borderRadius: '6px', fontSize: '0.85rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, color: '#f8fafc', marginBottom: '4px' }}>
                            <span>🔑 {item.issueKey}</span>
                            <span style={{ color: '#34d399' }}>{item.hours}h</span>
                          </div>
                          {item.summary && <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '4px' }}>{item.summary}</div>}
                          {item.comment && <div style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>💬 {item.comment}</div>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>기록된 상세 작업 내역이 없습니다.</div>
                  )}
                </div>
              )}
            </div>

            {/* 스플릿 리사이저 바 */}
            <div 
              onMouseDown={handleMouseDown} 
              style={{ width: '6px', background: '#1e293b', cursor: 'col-resize', transition: 'background 0.2s' }}
            />

            {/* 우측: 실시간 알림 로그 목록 */}
            <div style={{ 
              flex: 1, 
              height: '100%', 
              background: '#0b0f19', 
              padding: '16px', 
              boxSizing: 'border-box', 
              display: 'flex', 
              flexDirection: 'column',
              overflow: 'hidden'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>🔔 알림 및 모니터링 로그</h3>
                  {unreadCount > 0 && (
                    <span style={{ background: '#ef4444', color: 'white', borderRadius: '9999px', padding: '2px 8px', fontSize: '0.75rem', fontWeight: 700 }}>
                      미확인 {unreadCount}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    onClick={markAllAsRead}
                    style={{ padding: '4px 10px', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    모두 확인
                  </button>
                  <button 
                    onClick={clearLogs}
                    style={{ padding: '4px 10px', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
                  >
                    로그 비우기
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {logs.length > 0 ? (
                  logs.map((log, idx) => renderLogItem(log, idx))
                ) : (
                  <div style={{ textAlign: 'center', color: '#475569', padding: '40px 0', fontSize: '0.9rem' }}>
                    수신된 알림 로그가 없습니다.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 3. [보안 터널 & 설정 뷰] */}
        {viewMode === 'tunnel' && (
          <div style={{ height: '100%', width: '100%', overflowY: 'auto', padding: '32px', boxSizing: 'border-box', background: '#0b0f19' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
              
              <h2 style={{ color: '#60a5fa', margin: '0 0 8px 0', fontSize: '1.4rem' }}>
                🛡️ SSH 보안 터널 및 백엔드 연결 설정
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '24px', lineHeight: 1.5 }}>
                사내 웹서버 보안 점검에 걸리지 않도록, 우분투 PC의 웹서버는 외부 포트를 열지 않고 <code style={{ color: '#38bdf8' }}>127.0.0.1:3000</code>에만 바인딩되어 있습니다.
                윈도우 PC에서 SSH 암호화 터널을 연결하면 안전하게 데이터를 중계받을 수 있습니다.
              </p>

              {/* 연결 주소 설정 박스 */}
              <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '8px', padding: '20px', marginBottom: '24px' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#f8fafc', fontSize: '0.95rem' }}>
                  🌐 백엔드 연결 주소
                </h4>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input 
                    type="text" 
                    value={serverIp} 
                    onChange={(e) => setServerIp(e.target.value)} 
                    placeholder="예: http://localhost:3000 (SSH 터널 사용 시) 또는 http://192.168.105.10:3000"
                    style={{ flex: 1, padding: '10px 14px', borderRadius: '6px', border: '1px solid #374151', background: '#0f172a', color: 'white', fontSize: '0.9rem' }}
                  />
                  <button 
                    onClick={isConnected ? disconnectSSE : connectSSE} 
                    style={{ 
                      padding: '10px 20px', 
                      borderRadius: '6px', 
                      background: isConnected ? '#ef4444' : '#2563eb', 
                      color: 'white', 
                      border: 'none', 
                      cursor: 'pointer', 
                      fontWeight: 600,
                      fontSize: '0.9rem'
                    }}
                  >
                    {isConnecting ? '연결 중...' : isConnected ? '연결 끊기' : '연결 테스트'}
                  </button>
                </div>
                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#64748b' }}>
                  💡 SSH 터널을 맺은 경우 <strong style={{ color: '#93c5fd' }}>http://localhost:3000</strong> 을 입력하세요.
                </div>
              </div>

              {/* SSH 터널 원클릭 가이드 */}
              <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '8px', padding: '20px' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#f8fafc', fontSize: '0.95rem' }}>
                  ⚡ 윈도우 SSH 터널 연결 가이드
                </h4>
                <p style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: '14px' }}>
                  우분투 PC의 SSH 포트(22)를 통해 로컬 터널을 열어두면, 윈도우 PC의 <code style={{ color: '#38bdf8' }}>localhost:3000</code>이 우분투의 내부 서버와 직접 암호화 통신합니다:
                </p>

                <div style={{ background: '#0f172a', padding: '12px 16px', borderRadius: '6px', border: '1px solid #1e293b', fontFamily: 'monospace', fontSize: '0.85rem', color: '#34d399', marginBottom: '14px' }}>
                  ssh -N -L 3000:127.0.0.1:3000 [우분투_사용자명]@[우분투_IP]
                </div>

                <div style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6 }}>
                  <strong>팁:</strong> 프로젝트 폴더 내에 포함된 <code style={{ color: '#60a5fa' }}>start-tunnel.bat</code> 파일을 실행하시면 터널 연결과 앱 실행을 클릭 한 번으로 완료하실 수 있습니다.
                </div>
              </div>

            </div>
          </div>
        )}

      </main>

    </div>
  )
}

export default App
