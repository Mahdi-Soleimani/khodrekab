import React, { useEffect, useState } from 'react';

interface KhodrekabDebugStats {
  frame: number;
  progress: string;
  cacheSize: number;
  cacheCapacity: number;
  memoryProfile: string;
  loadedFrames: number;
  keyframesLoaded: number;
  totalKeyframes: number;
  fps: number;
  manifestVersion: string;
}

interface KhodrekabDebugPanelProps {
  getDebugStats: () => KhodrekabDebugStats | null;
}

export const KhodrekabDebugPanel: React.FC<KhodrekabDebugPanelProps> = ({ getDebugStats }) => {
  const [stats, setStats] = useState<KhodrekabDebugStats | null>(null);

  useEffect(() => {
    // Only poll in development
    if (process.env.NODE_ENV !== 'development') return;

    // Use setInterval to poll without hooking into the critical rendering path
    const intervalId = setInterval(() => {
      const currentStats = getDebugStats();
      if (currentStats) {
        setStats(currentStats);
      }
    }, 200); // 5 updates per second is enough for debug overlay

    return () => clearInterval(intervalId);
  }, [getDebugStats]);

  if (process.env.NODE_ENV !== 'development' || !stats) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: 10,
      right: 10,
      background: 'rgba(0, 0, 0, 0.85)',
      color: '#00ffcc',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '16px',
      borderRadius: '8px',
      zIndex: 9999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      pointerEvents: 'none',
      width: '200px'
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#fff' }}>CARNO DEBUG</h3>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Frame:</span>
        <br/>{stats.frame}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Progress:</span>
        <br/>{stats.progress}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>FPS:</span>
        <br/>{stats.fps}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Cache:</span>
        <br/>{stats.cacheSize} / {stats.cacheCapacity}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Memory Profile:</span>
        <br/>{stats.memoryProfile}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Loaded Frames:</span>
        <br/>{stats.loadedFrames}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Keyframes:</span>
        <br/>{stats.keyframesLoaded}/{stats.totalKeyframes}
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        <span style={{ color: '#888' }}>Manifest:</span>
        <br/>{stats.manifestVersion}
      </div>
    </div>
  );
};

export const CarnoDebugPanel = KhodrekabDebugPanel;
