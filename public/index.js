const { useState, useEffect } = React;

function SimpleLineChart({ data, dataKey, color, title }) {
    if (!data || data.length === 0) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                No data yet. Waiting for sensor messages...
            </div>
        );
    }

    const width = 800;
    const height = 300;
    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const values = data.map(d => d[dataKey]);
    const minVal = Math.min(...values) - 5;
    const maxVal = Math.max(...values) + 5;
    const range = maxVal - minVal;

    const points = data.map((d, i) => {
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((d[dataKey] - minVal) / range) * chartHeight;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div>
            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(p => (
                    <line
                        key={p}
                        x1={padding}
                        y1={padding + p * chartHeight}
                        x2={width - padding}
                        y2={padding + p * chartHeight}
                        stroke="#e0e0e0"
                        strokeWidth="1"
                    />
                ))}
                {/* Y-axis labels */}
                {[0, 0.25, 0.5, 0.75, 1].map(p => {
                    const val = maxVal - p * range;
                    return (
                        <text
                            key={p}
                            x={padding - 10}
                            y={padding + p * chartHeight + 5}
                            textAnchor="end"
                            fontSize="12"
                            fill="#666"
                        >
                            {val.toFixed(1)}
                        </text>
                    );
                })}
                {/* Line */}
                <polyline
                    points={points}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                />
                {/* Data points */}
                {data.map((d, i) => {
                    const x = padding + (i / (data.length - 1)) * chartWidth;
                    const y = padding + chartHeight - ((d[dataKey] - minVal) / range) * chartHeight;
                    return (
                        <circle
                            key={i}
                            cx={x}
                            cy={y}
                            r="3"
                            fill={color}
                        />
                    );
                })}
            </svg>
        </div>
    );
}

function PayloadSamplesChart({ payloadHistory }) {
    if (!payloadHistory || payloadHistory.length === 0) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                No payload data yet. Waiting for sensor messages...
            </div>
        );
    }

    // Get the latest payload with samples
    const latestPayload = payloadHistory[payloadHistory.length - 1];
    const samples = latestPayload.samples || [];

    if (samples.length === 0) {
        return (
            <div style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                No samples in payload.
            </div>
        );
    }

    // Apply moving average smoothing (window size 5)
    const smoothedSamples = samples.map((val, i) => {
        const start = Math.max(0, i - 2);
        const end = Math.min(samples.length, i + 3);
        const window = samples.slice(start, end);
        return window.reduce((a, b) => a + b, 0) / window.length;
    });

    const width = 1000;
    const height = 400;
    const padding = 50;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const minVal = Math.min(...smoothedSamples);
    const maxVal = Math.max(...smoothedSamples);
    const range = maxVal - minVal || 1;

    // Calculate points for the line using smoothed data
    const points = smoothedSamples.map((val, i) => {
        const x = padding + (i / (smoothedSamples.length - 1 || 1)) * chartWidth;
        const y = padding + chartHeight - ((val - minVal) / range) * chartHeight;
        return { x, y, val, index: i };
    });

    const pointsString = points.map(p => `${p.x},${p.y}`).join(' ');

    return (
        <div>
            <div style={{ marginBottom: '10px', fontSize: '14px', color: '#666' }}>
                Latest payload: {samples.length} samples | Avg: {latestPayload.avg} | Min: {latestPayload.min} | Max: {latestPayload.max} | Battery: {latestPayload.battery}V
            </div>
            <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
                {/* Grid lines - horizontal */}
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map(p => (
                    <line
                        key={`h-${p}`}
                        x1={padding}
                        y1={padding + p * chartHeight}
                        x2={width - padding}
                        y2={padding + p * chartHeight}
                        stroke="#e0e0e0"
                        strokeWidth="1"
                    />
                ))}
                {/* Grid lines - vertical */}
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map(p => (
                    <line
                        key={`v-${p}`}
                        x1={padding + p * chartWidth}
                        y1={padding}
                        x2={padding + p * chartWidth}
                        y2={height - padding}
                        stroke="#e0e0e0"
                        strokeWidth="1"
                    />
                ))}
                {/* Y-axis labels */}
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map(p => {
                    const val = maxVal - p * range;
                    return (
                        <text
                            key={`yl-${p}`}
                            x={padding - 10}
                            y={padding + p * chartHeight + 5}
                            textAnchor="end"
                            fontSize="11"
                            fill="#666"
                        >
                            {val.toFixed(0)}
                        </text>
                    );
                })}
                {/* X-axis labels */}
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map(p => {
                    const idx = Math.floor(p * (samples.length - 1));
                    return (
                        <text
                            key={`xl-${p}`}
                            x={padding + p * chartWidth}
                            y={height - padding + 20}
                            textAnchor="middle"
                            fontSize="11"
                            fill="#666"
                        >
                            {idx}
                        </text>
                    );
                })}
                {/* Main line */}
                <polyline
                    points={pointsString}
                    fill="none"
                    stroke="#ff6b6b"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                />
                {/* Data points (show every 5th point to avoid clutter) */}
                {points.filter((_, i) => i % 5 === 0 || i === points.length - 1).map((p, i) => (
                    <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r="3"
                        fill="#ff6b6b"
                        stroke="white"
                        strokeWidth="1"
                    />
                ))}
                {/* Start and end labels */}
                <text x={padding} y={padding - 10} fontSize="12" fill="#666">Start</text>
                <text x={width - padding} y={padding - 10} fontSize="12" fill="#666" textAnchor="end">End</text>
            </svg>
        </div>
    );
}

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [sensorData, setSensorData] = useState(null);
    const [rssiHistory, setRssiHistory] = useState([]);
    const [snrHistory, setSnrHistory] = useState([]);
    const [payloadAvgHistory, setPayloadAvgHistory] = useState([]);
    const [payloadHistory, setPayloadHistory] = useState([]);
    const [error, setError] = useState(null);
    const [messageCount, setMessageCount] = useState(0);

    useEffect(() => {
        console.log('Initializing WebSocket connection...');
        console.log('Host:', window.location.host);
        const ws = new WebSocket(`ws://${window.location.host}`);

        ws.onopen = () => {
            console.log('WebSocket connected');
            setIsConnected(true);
            setError(null);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received data:', data);
                setSensorData(data);
                setMessageCount(prev => prev + 1);

                // Update history for charts (keep last 50 points)
                const timestamp = new Date(data.timestamp).toLocaleTimeString();
                
                setRssiHistory(prev => {
                    const newHistory = [...prev, { time: timestamp, rssi: data.rssi }];
                    console.log('RSSI history:', newHistory);
                    return newHistory.slice(-100);
                });

                setSnrHistory(prev => {
                    const newHistory = [...prev, { time: timestamp, snr: data.snr }];
                    console.log('SNR history:', newHistory);
                    return newHistory.slice(-100);
                });

                // Update payload history if decoded payload exists
                if (data.decodedPayload && data.decodedPayload.samples) {
                    setPayloadHistory(prev => {
                        const newHistory = [...prev, {
                            time: timestamp,
                            samples: data.decodedPayload.samples,
                            avg: data.decodedPayload.avg,
                            min: data.decodedPayload.min,
                            max: data.decodedPayload.max,
                            battery: data.decodedPayload.batteryV
                        }];
                        console.log('Payload history:', newHistory);
                        return newHistory.slice(-100);
                    });

                    // Track average values over time for continuous plotting
                    setPayloadAvgHistory(prev => {
                        const newHistory = [...prev, {
                            time: timestamp,
                            avg: data.decodedPayload.avg,
                            min: data.decodedPayload.min,
                            max: data.decodedPayload.max,
                            battery: data.decodedPayload.batteryV
                        }];
                        console.log('Payload avg history:', newHistory);
                        return newHistory.slice(-100);
                    });
                }
            } catch (err) {
                console.error('Error parsing message:', err);
                setError('Failed to parse data');
            }
        };

        ws.onclose = () => {
            console.log('WebSocket disconnected');
            setIsConnected(false);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            setError('WebSocket connection error');
            setIsConnected(false);
        };

        return () => ws.close();
    }, []);

    return (
        <div className="container">
            <div className="header">
                <h1>
                    LoRaWAN Sensor Dashboard
                    <span className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
                        {isConnected ? '● Connected' : '○ Disconnected'}
                    </span>
                </h1>
                {error && <div style={{ color: 'red', marginTop: '10px', fontSize: '14px' }}>Error: {error}</div>}
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#666' }}>
                    Messages received: {messageCount} | RSSI points: {rssiHistory.length} | SNR points: {snrHistory.length} | Payload avg points: {payloadAvgHistory.length} | Latest samples: {payloadHistory.length > 0 ? payloadHistory[payloadHistory.length - 1]?.samples?.length : 0}
                </div>
            </div>

            {!sensorData && !error && (
                <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
                    <h2>Waiting for sensor data...</h2>
                    <p style={{ color: '#666', marginTop: '10px' }}>
                        {isConnected ? 'Connected to WebSocket. Waiting for device uplinks...' : 'Connecting to WebSocket...'}
                    </p>
                </div>
            )}

            {sensorData && (
                <div className="dashboard">
                    <div className="card">
                        <h2>Device Information</h2>
                        <div className="metric">
                            <span className="metric-label">Device Name</span>
                            <span className="metric-value">{sensorData.deviceName}</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">DevEUI</span>
                            <span className="metric-value">{sensorData.devEui}</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">FPort</span>
                            <span className="metric-value">{sensorData.fPort}</span>
                        </div>
                    </div>

                    <div className="card">
                        <h2>Signal Quality</h2>
                        <div className="metric">
                            <span className="metric-label">RSSI</span>
                            <span className="metric-value">{sensorData.rssi} dBm</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">SNR</span>
                            <span className="metric-value">{sensorData.snr} dB</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">Last Update</span>
                            <span className="metric-value">{new Date(sensorData.timestamp).toLocaleString()}</span>
                        </div>
                    </div>

                    <div className="card">
                        <h2>Payload Data</h2>
                        <div className="metric">
                            <span className="metric-label">Raw Data</span>
                            <span className="metric-value" style={{ wordBreak: 'break-all' }}>{sensorData.data || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            )}

            <div className="chart-container">
                <h2>RSSI History (dBm)</h2>
                <SimpleLineChart data={rssiHistory} dataKey="rssi" color="#8884d8" />
            </div>

            <div className="chart-container" style={{ marginTop: '20px' }}>
                <h2>SNR History (dB)</h2>
                <SimpleLineChart data={snrHistory} dataKey="snr" color="#82ca9d" />
            </div>

            <div className="chart-container" style={{ marginTop: '20px' }}>
                <h2>Payload Average Value History</h2>
                <SimpleLineChart data={payloadAvgHistory} dataKey="avg" color="#ff6b6b" />
            </div>

            <div className="chart-container" style={{ marginTop: '20px' }}>
                <h2>Payload Samples (Latest)</h2>
                <PayloadSamplesChart payloadHistory={payloadHistory} />
            </div>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
