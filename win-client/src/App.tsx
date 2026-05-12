import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [logs, setLogs] = useState<string[]>([])
  const [serverIp, setServerIp] = useState('http://192.168.105.10:3000')
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // 앱 시작 시 권한 요청 (웹 기본 Notification API)
    if ('Notification' in window && Notification.permission !== 'granted') {
      Notification.requestPermission()
    }
  }, [])

  const connectSSE = () => {
    if (isConnected) return;
    
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] 연결 시도 중... ${serverIp}`])
    const eventSource = new EventSource(`${serverIp}/api/notifications/stream`)

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'connected') {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ 서버 연결 완료: ${data.message}`])
        setIsConnected(true)
      } else if (data.type === 'notification') {
        const msg = `[${new Date().toLocaleTimeString()}] 🔔 알림 수신: [${data.title}] ${data.message}`
        setLogs(prev => [...prev, msg])
        
        // 윈도우 네이티브 알림 띄우기 (Tauri가 지원하는 웹 Notification 브릿지)
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(data.title, { body: data.message })
        }
      }
    }

    eventSource.onerror = (err) => {
      setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ❌ SSE 연결 오류. 재접속 대기 중...`])
      setIsConnected(false)
      eventSource.close()
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#60a5fa' }}>🔔 JIRA 백그라운드 알림 클라이언트</h2>
      <p style={{ color: '#888', fontSize: '0.9rem' }}>웹앱 서버와 연결하여 실시간으로 알림을 수신합니다.</p>
      
      <div style={{ margin: '20px 0', display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={serverIp} 
          onChange={(e) => setServerIp(e.target.value)} 
          style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #444', background: '#222', color: 'white' }}
        />
        <button 
          onClick={connectSSE} 
          disabled={isConnected}
          style={{ padding: '8px 16px', borderRadius: '4px', background: isConnected ? '#444' : '#3b82f6', color: 'white', border: 'none', cursor: isConnected ? 'not-allowed' : 'pointer' }}
        >
          {isConnected ? '연결됨' : '서버 연결'}
        </button>
      </div>

      <div style={{ background: '#111', padding: '15px', borderRadius: '8px', height: '350px', overflowY: 'auto', border: '1px solid #333' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#aaa', borderBottom: '1px solid #333', paddingBottom: '10px' }}>실시간 수신 로그</h4>
        {logs.length === 0 && <p style={{ color: '#555', textAlign: 'center', marginTop: '50px' }}>서버 연결 후 대기 중입니다...</p>}
        {logs.map((log, index) => (
          <div key={index} style={{ marginBottom: '8px', fontSize: '0.85rem', color: log.includes('❌') ? '#fca5a5' : log.includes('✅') ? '#86efac' : '#ddd' }}>
            {log}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
