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

  // ── 엑셀 다운로드 완료 토스트 알림 상태 ──
  const [downloadToast, setDownloadToast] = useState<{ show: boolean; filename: string; fullPath: string } | null>(null);

  // ── 수동 갱신 로딩 상태 ──
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [refreshingUser, setRefreshingUser] = useState<string | null>(null);

  // ── 자동 모니터링 주기 및 카운트다운 상태 ──
  const [monitorInterval, setMonitorInterval] = useState<number>(10);
  const monitorIntervalRef = useRef<number>(10);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(600);
  const [isChangingInterval, setIsChangingInterval] = useState(false);
  const refreshAllStatsRef = useRef<((isAuto?: boolean) => Promise<void>) | null>(null);

  // monitorIntervalRef를 항상 최신 상태로 동기화 (SSE 클로저 문제 방지)
  useEffect(() => {
    monitorIntervalRef.current = monitorInterval;
  }, [monitorInterval]);

  // 자동 갱신 카운트다운 타이머
  useEffect(() => {
    if (monitorInterval <= 0) return; // 0분(사용 안 함)이면 카운트다운 정지

    const timer = setInterval(() => {
      setCountdownSeconds(prev => {
        if (prev <= 1) {
          // ⏱️ 주기가 도래했을 때 전체 팀원 작업기록 자동 갱신 실행!
          if (refreshAllStatsRef.current) {
            refreshAllStatsRef.current(true);
          }
          return monitorIntervalRef.current * 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [monitorInterval]);

  const formatCountdown = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // 모니터링 자동 갱신 주기 변경 핸들러
  const handleUpdateInterval = async (newVal: number) => {
    setIsChangingInterval(true);
    const targetUrl = (serverIp || 'http://localhost:3000').replace(/\/$/, '');
    try {
      const res = await fetch(`${targetUrl}/api/notifications/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monitorInterval: newVal })
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success) {
        setMonitorInterval(newVal);
        monitorIntervalRef.current = newVal;
        setCountdownSeconds(newVal * 60);
        setLogs(prev => [{
          id: `cfg-manual-${Date.now()}`,
          receiveTime: new Date().toLocaleTimeString(),
          isRead: false,
          type: 'info',
          title: '⚙️ 자동 갱신 주기 변경',
          message: newVal === 0 
            ? '자동 업데이트가 비활성화되었습니다. (수동 갱신 전용)' 
            : `자동 업데이트 주기가 ${newVal}분으로 설정되었습니다.`
        }, ...prev]);
      } else {
        alert('주기 변경 실패: ' + (data.error || '오류'));
      }
    } catch (e: any) {
      console.error('주기 변경 오류:', e);
      alert(`주기 변경 중 오류가 발생했습니다: ${e.message}\n(서버 접속 주소: ${targetUrl})`);
    } finally {
      setIsChangingInterval(false);
    }
  };

  // ── 수동 갱신 시 alert 목록을 동기화하여 해결된 오류는 'resolved' 처리하고 새 오류/수정 히스토리를 반영하는 함수 ──
  const syncAlertLogs = (targetUser: string | null, rawAlerts: any[]) => {
    const currentAlerts = Array.isArray(rawAlerts) ? rawAlerts : [];
    const currentAlertMap = new Map<string, any>(currentAlerts.map((a: any) => [String(a.id), a]));
    const isTarget = (author: string) => {
      if (!targetUser) return true;
      return author === targetUser || author.includes(targetUser) || targetUser.includes(author);
    };

    setLogs(prev => {
      const resolvedNotis: any[] = [];
      const updatedPrev = prev.map((l: any) => {
        // 대상 팀원의 미해결 비정상 alert인데 이번 응답에 없는 경우 -> Jira에서 정상 수정되었거나 삭제됨!
        if (!l.resolved && ['INVALID_PROJECT', 'INVALID_TASK_TYPE'].includes(l.notiType) && isTarget(l.author)) {
          if (!currentAlertMap.has(String(l.id))) {
            resolvedNotis.push({
              id: `resolved-noti-${l.id}-${Date.now()}`,
              receiveTime: new Date().toLocaleTimeString(),
              isRead: false,
              type: 'success',
              notiType: 'WORKLOG_RESOLVED',
              title: `✨ [수정 완료] ${l.author} 작업기록 정상 반영`,
              message: `[${l.issueKey}] ${l.title} 항목이 올바른 포맷/내용으로 수정되어 오류가 해소되었습니다.`,
              issueKey: l.issueKey,
              author: l.author,
              worklogId: l.worklogId,
              previousTitle: l.title,
              previousMessage: l.message,
              previousComment: l.comment
            });
            return {
              ...l,
              resolved: true,
              isRead: true,
              resolvedAt: new Date().toLocaleTimeString()
            };
          }
        }

        // 이번에도 여전히 검출된 alert인 경우
        if (currentAlertMap.has(String(l.id))) {
          const latest = currentAlertMap.get(String(l.id)) as any;
          currentAlertMap.delete(String(l.id));
          return {
            ...l,
            ...(latest || {}),
            resolved: false,
            isRead: false,
            receiveTime: new Date().toLocaleTimeString()
          };
        }

        return l;
      });

      // 이번에 새로 검출된 alert들
      const freshAlerts = Array.from(currentAlertMap.values()).map((a: any) => ({
        ...a,
        resolved: false,
        isRead: false,
        receiveTime: new Date().toLocaleTimeString()
      }));

      return [...freshAlerts, ...resolvedNotis, ...updatedPrev];
    });

    // 신규 이상 항목이 있으면 알림음 발동
    if (currentAlerts.length > 0) {
      playSound();
      showMainWindow();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(targetUser ? `🚨 [${targetUser}] 비정상 작업기록 감지` : '🚨 비정상 작업기록 감지', {
          body: currentAlerts[0].message || `${currentAlerts.length}건의 포맷 오류 또는 미정의 항목이 있습니다.`
        });
      }
    }
  };

  // 전체 팀원 작업기록 갱신 함수 (isAuto: 자동 주기 갱신 여부)
  const refreshAllStats = async (isAuto = false) => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    const targetUrl = (serverIp || 'http://localhost:3000').replace(/\/$/, '');

    try {
      const res = await fetch(`${targetUrl}/api/notifications/initial-stats`, { cache: 'no-store' });
      const resData = await res.json();
      if (resData.success) {
        if (resData.stats) setUserStats(resData.stats);
        if (resData.details) setUserDetails(resData.details);

        // ── alert 목록 동기화 (해결된 오류는 resolved 처리 및 수정 히스토리 생성) ──
        syncAlertLogs(null, resData.alerts || []);

        const alertSuffix = resData.alerts?.length ? ` (⚠️ 이상 항목 ${resData.alerts.length}건 감지)` : '';
        const titleText = isAuto ? '⏱️ 전체 팀원 작업기록 자동 갱신 완료' : '🔄 전체 팀원 작업기록 갱신 완료';
        setLogs(prev => [{
          id: `${isAuto ? 'auto' : 'manual'}-all-${Date.now()}`,
          receiveTime: new Date().toLocaleTimeString(),
          isRead: false,
          type: resData.alerts?.length ? 'warning' : 'info',
          title: titleText,
          message: `총 ${Object.keys(resData.stats || {}).length}명의 당일 작업기록이 최신화되었습니다.${alertSuffix}`
        }, ...prev]);
      } else if (!isAuto) {
        alert("전체 작업기록 갱신 실패: " + (resData.error || "알 수 없는 오류"));
      }
    } catch (err: any) {
      console.error("전체 통계 갱신 오류:", err);
      if (!isAuto) {
        alert("전체 작업기록 갱신 중 오류가 발생했습니다: " + err.message);
      }
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // refreshAllStatsRef를 최신 상태로 유지
  useEffect(() => {
    refreshAllStatsRef.current = refreshAllStats;
  });

  // 개별 팀원 작업기록 수동 갱신 함수
  const refreshUserStats = async (userName: string) => {
    if (refreshingUser === userName) return;
    setRefreshingUser(userName);
    const targetUrl = serverIp.replace(/\/$/, '');

    try {
      const res = await fetch(`${targetUrl}/api/notifications/initial-stats?targetUser=${encodeURIComponent(userName)}`, { cache: 'no-store' });
      const resData = await res.json();
      if (resData.success) {
        if (resData.stats && resData.stats[userName] !== undefined) {
          setUserStats(prev => ({
            ...prev,
            [userName]: resData.stats[userName]
          }));
        }
        if (resData.details && resData.details[userName] !== undefined) {
          setUserDetails(prev => ({
            ...prev,
            [userName]: resData.details[userName]
          }));
        }

        // ── alert 목록 동기화 (해당 팀원의 해결된 오류는 resolved 처리 및 수정 히스토리 생성) ──
        syncAlertLogs(userName, resData.alerts || []);

        const count = resData.details?.[userName]?.length || 0;
        const hrs = resData.stats?.[userName] || 0;
        const alertSuffix = resData.alerts?.length ? ` (⚠️ 이상 항목 ${resData.alerts.length}건)` : '';
        setLogs(prev => [{
          id: `manual-user-${Date.now()}`,
          receiveTime: new Date().toLocaleTimeString(),
          isRead: false,
          type: resData.alerts?.length ? 'warning' : 'info',
          title: `🔄 ${userName} 님의 작업기록 갱신`,
          message: `당일 총 ${hrs}h (${count}건의 이슈) 최신 반영 완료${alertSuffix}`
        }, ...prev]);
      }
    } catch (err: any) {
      console.error(`${userName} 작업기록 갱신 오류:`, err);
    } finally {
      setRefreshingUser(null);
    }
  };

  // 팀원 카드 클릭 핸들러 (선택 및 즉시 최신 작업기록 자동 갱신)
  const handleSelectUser = (name: string) => {
    setSelectedUser(name);
    refreshUserStats(name);
  };

  // 서버 URL 저장
  useEffect(() => {
    localStorage.setItem('jira_server_url', serverIp);
  }, [serverIp]);

  // ── 대시보드(iframe) 엑셀 다운로드 요청 수신 및 저장 ──
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'TAURI_DOWNLOAD_EXCEL') {
        const { filename, base64, data } = event.data;
        try {
          let byteData: number[] = [];
          if (base64) {
            const binaryString = atob(base64);
            const len = binaryString.length;
            byteData = new Array(len);
            for (let i = 0; i < len; i++) {
              byteData[i] = binaryString.charCodeAt(i);
            }
          } else if (Array.isArray(data)) {
            byteData = data;
          }

          const { invoke } = await import('@tauri-apps/api/core');
          const fullPath = await invoke<string>('save_excel_file', {
            filename,
            data: byteData
          });
          setDownloadToast({ show: true, filename, fullPath });
          setLogs(prev => [{
            id: Date.now() + Math.random(),
            receiveTime: new Date().toLocaleTimeString(),
            isRead: false,
            type: 'info',
            msg: `[${new Date().toLocaleTimeString()}] 📥 엑셀 파일 저장 완료: ${filename}`
          }, ...prev]);

          // 6초 후 토스트 자동 닫기
          setTimeout(() => {
            setDownloadToast(prev => (prev?.fullPath === fullPath ? null : prev));
          }, 6000);
        } catch (err: any) {
          console.error("엑셀 파일 저장 실패:", err);
          alert(`엑셀 파일 저장 실패: ${err?.message || err}`);
        }
      } else if (event.data?.type === 'TAURI_COPY_CLIPBOARD') {
        const { text } = event.data;
        if (text) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('copy_to_clipboard', { text });
          } catch (e) {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(text).catch(() => {});
            }
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

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
    if (isConnecting) return;
    
    // 기존 연결이 있다면 명시적으로 종료 후 재연결
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

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
        try {
          const data = JSON.parse(event.data)
          const baseLog = { id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false };
          
          if (data.type === 'connected') {
            setLogs(prev => [{ ...baseLog, type: 'success', msg: `[${baseLog.receiveTime}] ✅ 백엔드 연결 완료: ${data.message}` }, ...prev])
            setIsConnected(true)
            // 현재 설정된 자동 갱신 주기 동기화
            fetch(`${targetUrl}/api/notifications/status`)
              .then(r => r.json())
              .then(statusData => {
                if (statusData && statusData.monitorInterval !== undefined) {
                  const sInterval = Number(statusData.monitorInterval);
                  setMonitorInterval(sInterval);
                  monitorIntervalRef.current = sInterval;
                  setCountdownSeconds(sInterval * 60);
                }
              })
              .catch(() => {});

            fetch(`${targetUrl}/api/notifications/initial-stats`)
              .then(res => res.json())
              .then(resData => {
                if (resData.success) {
                  if (resData.stats) setUserStats(resData.stats)
                  if (resData.details) setUserDetails(resData.details)
                  
                  // 초기 로딩 시 감지된 비정상 작업기록 목록 반영
                  if (Array.isArray(resData.alerts) && resData.alerts.length > 0) {
                    setLogs(prev => {
                      const existingIds = new Set(prev.map((l: any) => l.id));
                      const freshAlerts = resData.alerts.filter((a: any) => !existingIds.has(a.id));
                      return freshAlerts.length > 0 ? [...freshAlerts, ...prev] : prev;
                    });
                  }

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
            } else if (data.notiType === 'CONFIG_CHANGED') {
              if (data.monitorInterval !== undefined) {
                const sInterval = Number(data.monitorInterval);
                setMonitorInterval(sInterval);
                monitorIntervalRef.current = sInterval;
                setCountdownSeconds(sInterval * 60);
                setLogs(prev => [{
                  ...baseLog,
                  type: 'info',
                  title: '⚙️ 자동 갱신 주기 동기화',
                  message: sInterval === 0 
                    ? '서버 설정에 의해 자동 업데이트가 비활성화되었습니다. (수동 갱신 전용)' 
                    : `서버 설정에 의해 자동 업데이트 주기가 ${sInterval}분으로 변경되었습니다.`
                }, ...prev]);
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

              // 서버가 전달한 주기가 있거나 최신 ref의 주기로 카운트다운 리셋 (Stale Closure 방지)
              const currentInterval = (data.monitorInterval !== undefined)
                ? Number(data.monitorInterval)
                : monitorIntervalRef.current;

              if (currentInterval !== monitorIntervalRef.current) {
                setMonitorInterval(currentInterval);
                monitorIntervalRef.current = currentInterval;
              }

              if (currentInterval > 0) {
                setCountdownSeconds(currentInterval * 60);
              }
            } else {
              const logId = data.id || `sse-${Date.now()}-${Math.random()}`;
              let isAlreadyPresent = false;
              setLogs(prev => {
                if (prev.some((l: any) => l.id === logId)) {
                  isAlreadyPresent = true;
                  return prev;
                }
                return [{ ...data, ...baseLog, id: logId }, ...prev];
              });

              if (!isAlreadyPresent) {
                playSound();
                if ('Notification' in window && Notification.permission === 'granted') {
                  new Notification(data.title || "JIRA 알림", { body: data.message });
                }
                showMainWindow();
              }
            }
          }
        } catch (parseErr) {
          // ping 또는 주석 메시지는 무시
        }
      }

      eventSource.onerror = () => {
        setIsConnecting(false);
        // 만약 완전히 닫힌 경우에만 끊김 로그 추가
        if (eventSource.readyState === EventSource.CLOSED) {
          setIsConnected(false);
          setLogs(prev => [{ id: Date.now() + Math.random(), receiveTime: new Date().toLocaleTimeString(), isRead: false, type: 'error', msg: `[${new Date().toLocaleTimeString()}] ❌ SSE 연결 끊김 (서버 닫힘)` }, ...prev])
        } else if (eventSource.readyState === EventSource.CONNECTING) {
          // 브라우저 자동 재연결 시도 중
          setIsConnected(false);
        }
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

  // 통계 계산 (해결된 알림은 미확인 오류 통계에서 제외)
  const alertLogs = logs.filter(log => log.notiType && log.notiType !== 'USER_WORKLOG' && !log.resolved);
  const unreadCount = alertLogs.filter(log => !log.isRead).length;

  // 특정 팀원의 개별 작업기록(item)이 이상 항목인지 매칭하는 헬퍼 함수
  const getItemAnomalies = (userName: string, item: any) => {
    if (!userName || !item) return [];
    const itemComment = (item.comment || '').trim();
    const itemIssueKey = item.issueKey || '';
    const itemWorklogId = item.worklogId ? String(item.worklogId) : '';

    return logs.filter(log => {
      if (!log || !['INVALID_PROJECT', 'INVALID_TASK_TYPE', 'TIME_EXCEEDED'].includes(log.notiType)) {
        return false;
      }
      const authorMatches = log.author && (log.author === userName || log.author.includes(userName) || userName.includes(log.author));
      if (!authorMatches) return false;

      // worklogId가 일치하는 경우 최우선 매칭
      if (itemWorklogId && log.worklogId && String(log.worklogId) === itemWorklogId) {
        return true;
      }

      // issueKey 일치 여부
      const issueMatches = log.issueKey && itemIssueKey && log.issueKey === itemIssueKey;

      // 코멘트 일치 여부
      const logComment = (log.comment || '').trim();
      let commentMatches = false;
      if (itemComment && logComment) {
        commentMatches = itemComment === logComment || itemComment.includes(logComment) || logComment.includes(itemComment);
      }

      if (issueMatches && commentMatches) return true;
      if (issueMatches && !itemComment && !logComment) return true;
      if (commentMatches) return true;
      return issueMatches;
    });
  };

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
        cardBg = (isRead || log.resolved) ? 'rgba(51, 65, 85, 0.4)' : 'rgba(239, 68, 68, 0.15)';
        borderLeft = log.resolved ? '#10b981' : '#ef4444';
        icon = log.resolved ? '✓' : '🚨';
      } else if (log.notiType === 'INVALID_TASK_TYPE') {
        cardBg = (isRead || log.resolved) ? 'rgba(51, 65, 85, 0.4)' : 'rgba(245, 158, 11, 0.15)';
        borderLeft = log.resolved ? '#10b981' : '#f59e0b';
        icon = log.resolved ? '✓' : '⚠️';
      } else if (log.notiType === 'WORKLOG_RESOLVED') {
        cardBg = isRead ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.18)';
        borderLeft = '#10b981';
        icon = '✨';
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
            <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px', fontSize: '0.8rem', color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.4' }}>
              <strong style={{ color: '#cbd5e1' }}>기록 내용:</strong> {log.comment}
            </div>
          )}
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px', display: 'flex', gap: '12px', alignItems: 'center' }}>
            {log.issueKey && <span>🔑 {log.issueKey}</span>}
            {log.author && (
              <span 
                onClick={() => handleSelectUser(log.author)}
                style={{ cursor: 'pointer', color: '#93c5fd', textDecoration: 'underline', fontWeight: 600 }}
                title={`${log.author} 님의 작업기록 확인하기`}
              >
                👤 {log.author} (내역 보기)
              </span>
            )}
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
            <span>⚙️</span> 서버 설정
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

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  value={serverIp} 
                  onChange={(e) => setServerIp(e.target.value)} 
                  style={{ width: '210px', padding: '4px 8px', borderRadius: '4px', border: '1px solid #334155', background: '#1e293b', color: '#cbd5e1', fontSize: '0.78rem' }}
                  title="서버 접속 주소"
                />
                <button
                  onClick={isConnected ? disconnectSSE : connectSSE}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '4px',
                    border: 'none',
                    background: isConnected ? '#ef4444' : '#2563eb',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600
                  }}
                >
                  {isConnecting ? '연결 중...' : isConnected ? '연결 해제' : '서버 연결'}
                </button>
                <button
                  onClick={refreshDashboard}
                  title="화면 새로고침"
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
                  🔄
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
              sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-modals"
              allow="clipboard-read; clipboard-write; fullscreen"
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>👥</span> 팀원별 당일 작업시간 현황
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* 자동 업데이트 주기 선택 드롭다운 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>주기:</span>
                    <select
                      value={monitorInterval}
                      onChange={(e) => handleUpdateInterval(parseInt(e.target.value, 10))}
                      disabled={isChangingInterval}
                      style={{
                        background: '#1e293b',
                        color: monitorInterval === 0 ? '#fca5a5' : '#38bdf8',
                        border: monitorInterval === 0 ? '1px solid #ef4444' : '1px solid #38bdf8',
                        borderRadius: '6px',
                        padding: '4px 6px',
                        fontSize: '0.76rem',
                        fontWeight: 600,
                        cursor: isChangingInterval ? 'wait' : 'pointer',
                        outline: 'none'
                      }}
                      title="실시간 모니터링 자동 업데이트 주기를 변경합니다 (0: 사용 안 함)"
                    >
                      <option value={0}>🚫 자동 갱신 끄기</option>
                      <option value={3}>⚡ 3분 간격</option>
                      <option value={5}>⏱️ 5분 간격</option>
                      <option value={10}>🔄 10분 간격 (권장)</option>
                      <option value={15}>🕒 15분 간격</option>
                      <option value={30}>⏳ 30분 간격</option>
                      <option value={60}>🕐 60분 간격</option>
                    </select>
                  </div>

                  {/* 주기/카운트다운 상태 뱃지 */}
                  {monitorInterval === 0 ? (
                    <span style={{
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid #ef4444',
                      color: '#fca5a5',
                      padding: '3px 8px',
                      borderRadius: '5px'
                    }}>
                      🛑 자동갱신 꺼짐
                    </span>
                  ) : (
                    <span style={{
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid #10b981',
                      color: '#6ee7b7',
                      padding: '3px 8px',
                      borderRadius: '5px'
                    }} title={`현재 ${monitorInterval}분 주기로 자동 갱신됩니다`}>
                      ⏱️ {formatCountdown(countdownSeconds)} 후 갱신
                    </span>
                  )}

                  <button
                    onClick={() => refreshAllStats(false)}
                    disabled={isRefreshingAll}
                    style={{
                      background: isRefreshingAll ? '#334155' : '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '5px 12px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: isRefreshingAll ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                      transition: 'all 0.2s'
                    }}
                    title="모든 팀원의 Jira 당일 작업기록을 즉시 다시 수집합니다"
                  >
                    <span>🔄</span>
                    {isRefreshingAll ? '전체 갱신 중...' : '전체 갱신'}
                  </button>
                </div>
              </div>

              {/* ── 전체 갱신/실시간 수집된 이상 항목 상단 경고 배너 ── */}
              {unreadCount > 0 && (
                <div style={{
                  background: 'linear-gradient(90deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.15) 100%)',
                  border: '1px solid #ef4444',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.25)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.3rem' }}>🚨</span>
                    <div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fca5a5' }}>
                        당일 비정상 작업기록 {unreadCount}건 감지됨
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#e2e8f0', marginTop: '2px' }}>
                        포맷 미준수, 미등록 프로젝트 코드 또는 미정의 작업유형이 포함되어 있습니다.
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {Array.from(new Set(alertLogs.filter(l => !l.isRead).map(l => l.author).filter(Boolean))).map(authorName => (
                      <button
                        key={authorName}
                        onClick={() => handleSelectUser(authorName)}
                        style={{
                          background: selectedUser === authorName ? '#ef4444' : 'rgba(239, 68, 68, 0.35)',
                          color: '#ffffff',
                          border: '1px solid #ef4444',
                          borderRadius: '6px',
                          padding: '3px 8px',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.15s'
                        }}
                        title={`${authorName} 님의 상세 내역 확인`}
                      >
                        ⚠️ {authorName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {Object.keys(userStats).length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: '12px' }}>
                  {Object.entries(userStats).map(([name, hours]) => {
                    const userAlerts = logs.filter(log => 
                      !log.resolved &&
                      ['INVALID_PROJECT', 'INVALID_TASK_TYPE', 'TIME_EXCEEDED'].includes(log.notiType) &&
                      (log.author === name || log.author?.includes(name) || name.includes(log.author || ''))
                    );
                    const hasUnreadAlert = userAlerts.some(log => !log.isRead);
                    const alertCount = userAlerts.length;

                    return (
                      <div 
                        key={name} 
                        onClick={() => handleSelectUser(name)}
                        style={{ 
                          background: selectedUser === name 
                            ? (hasUnreadAlert ? 'rgba(239, 68, 68, 0.25)' : '#1e293b')
                            : (hasUnreadAlert ? 'rgba(239, 68, 68, 0.12)' : '#111827'), 
                          border: hasUnreadAlert 
                            ? (selectedUser === name ? '2px solid #ef4444' : '1.5px solid #ef4444') 
                            : (selectedUser === name ? '2px solid #3b82f6' : '1px solid #1f2937'), 
                          borderRadius: '8px', 
                          padding: '12px', 
                          display: 'flex', 
                          flexDirection: 'column', 
                          alignItems: 'center', 
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          position: 'relative',
                          boxShadow: hasUnreadAlert ? '0 0 12px rgba(239, 68, 68, 0.35)' : 'none'
                        }}
                      >
                        {hasUnreadAlert ? (
                          <span style={{ 
                            position: 'absolute', 
                            top: '6px', 
                            right: '6px', 
                            background: '#ef4444', 
                            color: '#ffffff', 
                            fontSize: '0.65rem', 
                            fontWeight: 800, 
                            padding: '2px 6px', 
                            borderRadius: '9999px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px'
                          }}>
                            🚨 {userAlerts.filter(l => !l.isRead).length}
                          </span>
                        ) : alertCount > 0 ? (
                          <span style={{ 
                            position: 'absolute', 
                            top: '6px', 
                            right: '6px', 
                            background: '#334155', 
                            color: '#94a3b8', 
                            fontSize: '0.65rem', 
                            fontWeight: 600, 
                            padding: '1px 5px', 
                            borderRadius: '9999px' 
                          }}>
                            ✓ {alertCount}
                          </span>
                        ) : null}
                        {renderDonut(hours)}
                        <span style={{ 
                          marginTop: '8px', 
                          fontSize: '0.85rem', 
                          fontWeight: 600, 
                          color: hasUnreadAlert ? '#fca5a5' : '#f8fafc', 
                          textAlign: 'center',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}>
                          {hasUnreadAlert && <span>⚠️</span>}
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
              {selectedUser && (() => {
                const userActiveAlerts = logs.filter(l => 
                  !l.resolved &&
                  ['INVALID_PROJECT', 'INVALID_TASK_TYPE', 'TIME_EXCEEDED'].includes(l.notiType) &&
                  (l.author === selectedUser || l.author?.includes(selectedUser) || selectedUser.includes(l.author || ''))
                );
                const userResolvedAlerts = logs.filter(l => 
                  (l.resolved || l.notiType === 'WORKLOG_RESOLVED') &&
                  (l.author === selectedUser || l.author?.includes(selectedUser) || selectedUser.includes(l.author || ''))
                );

                return (
                  <div style={{ 
                    marginTop: '20px', 
                    background: userActiveAlerts.length > 0 ? 'linear-gradient(180deg, #181c2b 0%, #111827 100%)' : '#111827', 
                    border: userActiveAlerts.length > 0 ? '1.5px solid #ef4444' : userResolvedAlerts.length > 0 ? '1.5px solid rgba(16, 185, 129, 0.4)' : '1px solid #1f2937', 
                    borderRadius: '8px', 
                    padding: '16px',
                    boxShadow: userActiveAlerts.length > 0 ? '0 4px 16px rgba(239, 68, 68, 0.2)' : 'none'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', borderBottom: '1px solid #1e293b', paddingBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h4 style={{ margin: 0, color: '#60a5fa', fontSize: '0.98rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>📋</span> {selectedUser} 님의 당일 작업 내역
                        </h4>
                        <span style={{ fontSize: '0.82rem', color: '#34d399', fontWeight: 'bold', background: 'rgba(52, 211, 153, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
                          총 {userStats[selectedUser] || 0}h
                        </span>
                        {userActiveAlerts.length > 0 ? (
                          <span style={{ 
                            background: '#ef4444', 
                            color: '#ffffff', 
                            fontSize: '0.74rem', 
                            fontWeight: 800, 
                            padding: '2px 8px', 
                            borderRadius: '9999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 2px 6px rgba(239, 68, 68, 0.4)'
                          }}>
                            🚨 비정상 기록 {userActiveAlerts.length}건 감지됨
                          </span>
                        ) : userResolvedAlerts.length > 0 ? (
                          <span style={{ 
                            background: 'rgba(16, 185, 129, 0.15)', 
                            color: '#34d399', 
                            border: '1px solid rgba(16, 185, 129, 0.4)',
                            fontSize: '0.74rem', 
                            fontWeight: 700, 
                            padding: '2px 8px', 
                            borderRadius: '9999px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            ✨ 오류 수정 완료 (정상 반영됨)
                          </span>
                        ) : null}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          onClick={() => refreshUserStats(selectedUser)}
                          disabled={refreshingUser === selectedUser}
                          style={{
                            background: refreshingUser === selectedUser ? '#334155' : '#1e293b',
                            color: '#93c5fd',
                            border: '1px solid #3b82f6',
                            borderRadius: '4px',
                            padding: '4px 10px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: refreshingUser === selectedUser ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                          }}
                          title="이 팀원의 최신 작업기록만 Jira에서 즉시 다시 가져옵니다"
                        >
                          🔄 {refreshingUser === selectedUser ? '조회 중...' : '기록 갱신'}
                        </button>
                        <button 
                          onClick={() => setSelectedUser(null)}
                          style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.95rem', padding: '2px 6px' }}
                          title="닫기"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {refreshingUser === selectedUser && (
                      <div style={{ padding: '10px 14px', background: 'rgba(59, 130, 246, 0.12)', border: '1px dashed #3b82f6', borderRadius: '6px', marginBottom: '12px', fontSize: '0.82rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        ⏳ Jira에서 {selectedUser} 님의 최신 작업기록을 조회하고 있습니다...
                      </div>
                    )}
                    
                    {userDetails[selectedUser] && userDetails[selectedUser].length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {userDetails[selectedUser].map((item, idx) => {
                          const anomalies = getItemAnomalies(selectedUser, item);
                          const activeAnomalies = anomalies.filter(a => !a.resolved);
                          const hasActiveAnomaly = activeAnomalies.length > 0;

                          // 이전에 이 항목에 오류가 발생했으나 수정되어 해결된 히스토리 매칭
                          const resolvedAnomalies = logs.filter(l => 
                            (l.resolved || l.notiType === 'WORKLOG_RESOLVED') &&
                            (l.author === selectedUser || l.author?.includes(selectedUser) || selectedUser.includes(l.author || '')) &&
                            (
                              (item.worklogId && l.worklogId && String(item.worklogId) === String(l.worklogId)) ||
                              (l.issueKey && item.issueKey && l.issueKey === item.issueKey)
                            )
                          );
                          const hasResolvedHistory = !hasActiveAnomaly && (resolvedAnomalies.length > 0 || item.isEdited);

                          const jiraUrl = `${serverIp.replace(/\/$/, '')}/browse/${item.issueKey}`;

                          return (
                            <div 
                              key={idx} 
                              style={{ 
                                background: hasActiveAnomaly 
                                  ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(185, 28, 28, 0.08) 100%)' 
                                  : '#1e293b', 
                                border: hasActiveAnomaly 
                                  ? '1.5px solid #ef4444' 
                                  : hasResolvedHistory 
                                    ? '1px solid rgba(16, 185, 129, 0.4)' 
                                    : '1px solid #334155',
                                borderLeft: hasActiveAnomaly 
                                  ? '6px solid #ef4444' 
                                  : hasResolvedHistory 
                                    ? '5px solid #10b981' 
                                    : '4px solid #10b981',
                                borderRadius: '8px', 
                                padding: '12px',
                                fontSize: '0.85rem',
                                boxShadow: hasActiveAnomaly 
                                  ? '0 4px 14px rgba(239, 68, 68, 0.22)' 
                                  : hasResolvedHistory 
                                    ? '0 2px 10px rgba(16, 185, 129, 0.15)' 
                                    : 'none',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {/* 1. 현재 오류가 있는 경우: 붉은색 오류 경고 배너 */}
                              {hasActiveAnomaly && (
                                <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  {activeAnomalies.map((anom, aIdx) => (
                                    <div 
                                      key={aIdx} 
                                      style={{ 
                                        background: 'rgba(239, 68, 68, 0.25)', 
                                        border: '1px solid #ef4444', 
                                        borderRadius: '6px', 
                                        padding: '6px 10px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px'
                                      }}
                                    >
                                      <div style={{ color: '#fca5a5', fontWeight: 800, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span>🚨</span> [{anom.title}]
                                      </div>
                                      <div style={{ color: '#fee2e2', fontSize: '0.78rem', lineHeight: '1.4' }}>
                                        👉 {anom.message}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* 2. 오류가 수정된 히스토리가 있는 경우: 정상 UX와 함께 수정 히스토리 배너 표시 */}
                              {hasResolvedHistory && (
                                <div style={{ 
                                  marginBottom: '8px', 
                                  background: 'rgba(16, 185, 129, 0.1)', 
                                  border: '1px solid rgba(16, 185, 129, 0.3)', 
                                  borderRadius: '6px', 
                                  padding: '7px 10px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '2px'
                                }}>
                                  <div style={{ color: '#34d399', fontWeight: 800, fontSize: '0.79rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <span>✨</span> 작업기록 수정 히스토리: 정상 반영 완료
                                  </div>
                                  <div style={{ color: '#cbd5e1', fontSize: '0.74rem', lineHeight: '1.4' }}>
                                    {resolvedAnomalies[0]?.previousTitle ? (
                                      <span>
                                        이전 오류 <strong style={{ color: '#fca5a5' }}>[{resolvedAnomalies[0].previousTitle}]</strong> ({resolvedAnomalies[0].previousMessage || '포맷/코드 오류'}) 항목이 <strong style={{ color: '#6ee7b7' }}>정상 내용으로 수정되어 오류가 완전히 해소되었습니다.</strong>
                                      </span>
                                    ) : (
                                      <span>Jira에서 작업기록 코멘트가 정상 포맷으로 수정 반영되었습니다.</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* 이슈 키 & 소요 시간 */}
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '0.9rem', color: hasActiveAnomaly ? '#fca5a5' : '#f8fafc' }}>
                                    🔑 {item.issueKey}
                                  </span>
                                  <a 
                                    href={activeAnomalies[0]?.url || jiraUrl} 
                                    target="_blank" 
                                    rel="noreferrer" 
                                    style={{ 
                                      color: '#60a5fa', 
                                      fontSize: '0.74rem', 
                                      textDecoration: 'none',
                                      padding: '1px 6px',
                                      borderRadius: '4px',
                                      border: '1px solid rgba(96, 165, 250, 0.4)',
                                      background: 'rgba(96, 165, 250, 0.1)'
                                    }}
                                    title="Jira에서 이슈 열기"
                                  >
                                    🔗 Jira 열기
                                  </a>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {hasActiveAnomaly ? (
                                    <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, background: 'rgba(239, 68, 68, 0.2)', padding: '1px 6px', borderRadius: '4px' }}>
                                      수정 필요
                                    </span>
                                  ) : hasResolvedHistory ? (
                                    <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700, background: 'rgba(16, 185, 129, 0.2)', padding: '1px 6px', borderRadius: '4px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                      ✓ 수정 완료
                                    </span>
                                  ) : null}
                                  <span style={{ color: '#34d399', fontSize: '0.92rem', fontWeight: 700 }}>
                                    {item.hours}h
                                  </span>
                                </div>
                              </div>

                              {/* 이슈 요약 */}
                              {item.summary && (
                                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '6px', lineHeight: '1.3' }}>
                                  {item.summary}
                                </div>
                              )}

                              {/* 코멘트 (현재 오류인 경우만 붉은 점선 강조, 정상이거나 수정 완료인 경우 깔끔한 정상 코멘트 박스로 표시) */}
                              {item.comment ? (
                                <div style={{ 
                                  color: hasActiveAnomaly ? '#fed7aa' : '#cbd5e1', 
                                  fontSize: '0.8rem', 
                                  marginTop: '6px',
                                  padding: '8px 10px',
                                  borderRadius: '5px',
                                  background: hasActiveAnomaly ? 'rgba(239, 68, 68, 0.12)' : 'rgba(15, 23, 42, 0.6)',
                                  border: hasActiveAnomaly ? '1px dashed #ef4444' : hasResolvedHistory ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid #334155',
                                  lineHeight: '1.4',
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word'
                                }}>
                                  <strong style={{ color: hasActiveAnomaly ? '#fca5a5' : hasResolvedHistory ? '#34d399' : '#94a3b8', marginRight: '4px' }}>
                                    💬 {hasResolvedHistory ? '수정된 코멘트:' : '코멘트:'}
                                  </strong>
                                  {item.comment}
                                </div>
                              ) : (
                                hasActiveAnomaly && (
                                  <div style={{ color: '#f87171', fontSize: '0.78rem', fontStyle: 'italic', marginTop: '4px' }}>
                                    ⚠️ 코멘트(작업기록 내용)가 작성되지 않았습니다.
                                  </div>
                                )
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div style={{ color: '#64748b', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
                        기록된 상세 작업 내역이 없습니다.
                      </div>
                    )}
                  </div>
                );
              })()}
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

      {/* ── 엑셀 다운로드 완료 플로팅 알림 (Toast) ── */}
      {downloadToast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: '#1e293b',
          border: '1px solid #10b981',
          borderRadius: '10px',
          padding: '14px 18px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          maxWidth: '420px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📥 엑셀 다운로드 완료
            </span>
            <button
              onClick={() => setDownloadToast(null)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#f1f5f9', fontWeight: '600', wordBreak: 'break-all' }}>
            {downloadToast.filename}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8', wordBreak: 'break-all', fontFamily: 'monospace', background: '#0f172a', padding: '4px 6px', borderRadius: '4px' }}>
            {downloadToast.fullPath}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
            <button
              onClick={async () => {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  await invoke('open_file_in_folder', { path: downloadToast.fullPath });
                } catch (e) {
                  console.error(e);
                }
              }}
              style={{
                background: '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '0.78rem',
                cursor: 'pointer',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              📂 저장 폴더 열기
            </button>
          </div>
        </div>
      )}

    </div>
  )
}

export default App
