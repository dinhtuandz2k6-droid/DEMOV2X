/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Activity, 
  Shield, 
  Radio, 
  MapPin, 
  AlertTriangle, 
  Database, 
  Cpu, 
  Navigation,
  History,
  Zap,
  Lock,
  ShieldCheck,
  Clock,
  Share2,
  BookOpen,
  Terminal,
  CheckCircle2,
  Camera,
  Layers,
  Search,
  Settings2,
  LogIn,
  LogOut,
  Download,
  User as UserIcon
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  Legend
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { SensorData, V2XMessage, Block } from './types';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, query, where, getDocs, orderBy, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';

// Constants for simulation
const COLLISION_THRESHOLD = 2.5; // G-force
const WARNING_DISTANCE = 2; // meters (Updated to <2m per request)
const V2X_RANGE = 500; // meters
const BLOCK_SIZE = 5;

export default function App() {
  // State for sensors
  const [sensorData, setSensorData] = useState<SensorData[]>([]);
  const [currentData, setCurrentData] = useState<SensorData | null>(null);
  
  // State for V2X
  const [v2xMessages, setV2xMessages] = useState<V2XMessage[]>([]);
  const [activeAlert, setActiveAlert] = useState<boolean>(false);
  const [v2xLatency, setV2xLatency] = useState<number>(12);
  const [nodeStatus, setNodeStatus] = useState<('online' | 'offline' | 'attacked')[]>(['online', 'online', 'online', 'online', 'online']);
  const [isFailSafeActive, setIsFailSafeActive] = useState(false);
  
  // State for Blockchain
  const [blockchain, setBlockchain] = useState<Block[]>([]);
  const [pendingMessages, setPendingMessages] = useState<V2XMessage[]>([]);
  const [blockchainTxTime, setBlockchainTxTime] = useState<number>(2.1);

  // State for Radar (Vehicle B, C, D)
  const [vehicleBPos, setVehicleBPos] = useState({ x: 40, y: -60, distance: 72 });
  const [vehicleCPos, setVehicleCPos] = useState({ x: -80, y: 30, distance: 85 });
  const [vehicleDPos, setVehicleDPos] = useState({ x: 50, y: 90, distance: 103 });

  // Simulation controls
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);

  // Scenario Management
  const [currentScenario, setCurrentScenario] = useState<number | null>(null);
  const [scenarioStep, setScenarioStep] = useState(0);
  const [preventionMeasure, setPreventionMeasure] = useState<string>("");
  const [scenarioExplanation, setScenarioExplanation] = useState<string>("");
  const [scenarioMechanism, setScenarioMechanism] = useState<string>("");
  const [capturedSnapshot, setCapturedSnapshot] = useState<any>(null);
  const [scenarioHistory, setScenarioHistory] = useState<any[]>([]);

  const [isSimulatingCollision, setIsSimulatingCollision] = useState(false);
  const [eventStatus, setEventStatus] = useState<'NORMAL' | 'WARNING' | 'ACCIDENT'>('NORMAL');
  const [isSendingManualData, setIsSendingManualData] = useState(false);
  const [isExportingDB, setIsExportingDB] = useState(false);

  // Firebase User State
  const [user, setUser] = useState<User | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Sync historical data from Firestore
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        syncData(currentUser.uid);
      } else {
        setScenarioHistory([]);
        setBlockchain([]);
      }
    });
    return () => unsubscribe();
  }, []);

  const syncData = async (uid: string) => {
    setIsSyncing(true);
    try {
      // Fetch reports
      const reportsQuery = query(
        collection(db, 'reports'),
        where('userId', '==', uid),
        orderBy('id', 'desc'),
        limit(20)
      );
      const reportsSnapshot = await getDocs(reportsQuery);
      const fetchedReports = reportsSnapshot.docs.map(doc => doc.data());
      setScenarioHistory(fetchedReports);

      // Fetch blocks
      const blocksQuery = query(
        collection(db, 'blocks'),
        where('userId', '==', uid),
        orderBy('index', 'asc')
      );
      const blocksSnapshot = await getDocs(blocksQuery);
      const fetchedBlocks = blocksSnapshot.docs.map(doc => doc.data());
      if (fetchedBlocks.length > 0) {
        setBlockchain(fetchedBlocks as Block[]);
      } else {
        // Only set genesis if no blocks found
        const genesisBlock: Block = {
          index: 0,
          timestamp: Date.now(),
          messages: [],
          previousHash: "0",
          hash: "7e5e7e..._GENESIS",
          nonce: 0
        };
        setBlockchain([genesisBlock]);
      }
    } catch (error) {
      console.error("Error syncing data:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const persistReport = async (report: any) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'reports'), {
        ...report,
        userId: user.uid,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.error("Error persisting report:", e);
    }
  };

  const persistBlock = async (block: Block) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'blocks'), {
        ...block,
        userId: user.uid,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.error("Error persisting block:", e);
    }
  };

  const handleExportExcel = () => {
    if (scenarioHistory.length === 0) {
      alert("Không có dữ liệu để xuất!");
      return;
    }

    // Flatten data for Excel
    const dataToExport = scenarioHistory.map(report => ({
      'ID': report.id,
      'Kịch bản': report.scenarioId,
      'Tên kịch bản': report.name,
      'Thời gian': report.timestamp,
      'Gia tốc (Accel)': report.data.accel || '',
      'Phương chiều (Heading)': report.data.heading || '',
      'V2X Status': report.data.v2x || '',
      'Khoảng cách (Distance)': report.data.distance || '',
      'Thuật toán (Algorithm)': report.data.algorithm || '',
      'Cảnh báo (Alert)': report.data.alert || '',
      'Trạng thái': report.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "ScenarioHistory");
    
    // Generate Buffer
    XLSX.writeFile(workbook, `V2X_Collision_Report_${new Date().getTime()}.xlsx`);
  };

  const sendManualSimulationData = async () => {
    if (!user) {
      alert("Bạn cần nhấn 'Kết nối Database' ở trên cùng trước khi gửi dữ liệu!");
      return;
    }
    
    setIsSendingManualData(true);
    try {
      const manualSnapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 0,
          name: "Dữ liệu thủ công (NCKH Control)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            accel: `${currentData?.accelX.toFixed(2) || '0.00'}G`,
            heading: `${currentData?.heading.toFixed(1) || '0.0'}°`,
            lat: currentData?.lat.toFixed(4) || '0.0000',
            lng: currentData?.lng.toFixed(4) || '0.0000',
            v2x: "Manual Trigger",
            hash: "sha256_" + Math.random().toString(36).substring(7),
          },
          status: eventStatus
      };
      
      // Update local history
      setScenarioHistory(prev => [manualSnapshot, ...prev]);
      
      // Push to Firestore
      await addDoc(collection(db, 'reports'), {
        ...manualSnapshot,
        userId: user.uid,
        createdAt: new Date().toISOString()
      });
      
      alert("Đã gửi dữ liệu mô phỏng thành công lên Firestore!");
    } catch (e) {
      console.error("Manual send error:", e);
      alert("Lỗi khi gửi dữ liệu!");
    } finally {
      setIsSendingManualData(false);
    }
  };

  const exportFromFirestore = async () => {
    if (!user) {
      alert("Cần kết nối Database để lấy dữ liệu lịch sử!");
      return;
    }

    setIsExportingDB(true);
    try {
      const q = query(
        collection(db, 'reports'), 
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      
      const querySnapshot = await getDocs(q);
      const rows: any[] = [];
      
      querySnapshot.forEach((doc) => {
        const item = doc.data();
        rows.push({
          'Firebase_ID': doc.id,
          'Kịch bản': item.name,
          'Thời gian': item.timestamp,
          'Gia tốc (G)': item.data.accel,
          'Phương hướng (°)': item.data.heading,
          'Tọa độ': `${item.data.lat}, ${item.data.lng}`,
          'Dữ liệu V2X': item.data.v2x,
          'Mã Hash': item.data.hash || 'N/A',
          'Trạng thái': item.status,
          'Ngày tạo (UTC)': item.createdAt
        });
      });

      if (rows.length === 0) {
        alert("Không tìm thấy dữ liệu nào trên Database của bạn!");
        return;
      }

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "NCKH_Database_Export");
      XLSX.writeFile(workbook, `V2X_NCKH_DB_Export_${new Date().getTime()}.xlsx`);
    } catch (e) {
      console.error("DB Export error:", e);
      alert("Lỗi khi truy vấn dữ liệu từ CSDL!");
    } finally {
      setIsExportingDB(false);
    }
  };

  // Traffic Flow Data for Intersections
  const [intersectionData, setIntersectionData] = useState([
    { name: 'Nút giao A', flow: 450, status: 'Ổn định', capacity: 1000, light: 'green', timer: 45, cameras: 4 },
    { name: 'Nút giao B', flow: 780, status: 'Đông', capacity: 1000, light: 'red', timer: 12, cameras: 3 },
    { name: 'Nút giao C', flow: 320, status: 'Thoáng', capacity: 1000, light: 'green', timer: 28, cameras: 2 },
    { name: 'Nút giao D', flow: 560, status: 'Ổn định', capacity: 1000, light: 'yellow', timer: 3, cameras: 4 },
    { name: 'Nút giao E', flow: 910, status: 'Ùn ứ', capacity: 1000, light: 'red', timer: 55, cameras: 5 },
  ]);

  // Update traffic flow and lights periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setIntersectionData(prev => prev.map(item => {
        let newTimer = item.timer - 1;
        let newLight = item.light;

        if (newTimer <= 0) {
          if (item.light === 'green') {
            newLight = 'yellow';
            newTimer = 5;
          } else if (item.light === 'yellow') {
            newLight = 'red';
            newTimer = 60;
          } else {
            newLight = 'green';
            newTimer = 60;
          }
        }

        return {
          ...item,
          flow: Math.max(100, Math.min(1000, item.flow + (Math.random() > 0.5 ? 20 : -20))),
          timer: newTimer,
          light: newLight
        };
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize Blockchain with Genesis Block
  useEffect(() => {
    // Only initialize if blockchain is empty to avoid overwriting sync data
    setBlockchain(prev => {
      if (prev.length > 0) return prev;
      const genesisBlock: Block = {
        index: 0,
        timestamp: Date.now(),
        messages: [],
        previousHash: "0",
        hash: "genesis_hash_" + Math.random().toString(36).substring(2, 15),
        nonce: 0
      };
      return [genesisBlock];
    });
  }, []);

  // Simulation Loop
  useEffect(() => {
    if (!isSimulating || isSimulatingCollision) return;

    const interval = setInterval(() => {
      // 1. Simulate MPU6050 & GPS Holybro Data
      const timestamp = Date.now();
      
      // Normal noise + occasional spikes for collision testing
      const isCollisionEvent = Math.random() > 0.98;
      const accelX = (Math.random() - 0.5) * 0.5 + (isCollisionEvent ? (Math.random() > 0.5 ? 3 : -3) : 0);
      const accelY = (Math.random() - 0.5) * 0.5;
      const accelZ = 1 + (Math.random() - 0.5) * 0.2; // Gravity + noise

      const heading = (currentData?.heading || 0 + (Math.random() - 0.5) * 10) % 360;
      const lat = 21.0285 + (Math.random() - 0.5) * 0.001; // Near Hanoi
      const lng = 105.8542 + (Math.random() - 0.5) * 0.001;

      const newData: SensorData = {
        timestamp,
        accelX,
        accelY,
        accelZ,
        heading,
        lat,
        lng,
        vehicleId: "VEHICLE_01"
      };

      setCurrentData(newData);
      setSensorData(prev => [...prev.slice(-20), newData]);

      // Update Latency (Randomized for realism)
      setV2xLatency(Math.floor(Math.random() * 10) + 5);

      // Update Vehicle B, C, D positions (Moving slightly)
      setVehicleBPos(prev => {
        const newX = prev.x + (Math.random() - 0.5) * 2;
        const newY = prev.y + (Math.random() - 0.5) * 2;
        const dist = Math.sqrt(newX**2 + newY**2);
        return { x: newX, y: newY, distance: Math.round(dist) };
      });

      setVehicleCPos(prev => {
        const newX = prev.x + (Math.random() - 0.5) * 1.5;
        const newY = prev.y + (Math.random() - 0.5) * 1.5;
        const dist = Math.sqrt(newX**2 + newY**2);
        return { x: newX, y: newY, distance: Math.round(dist) };
      });

      setVehicleDPos(prev => {
        const newX = prev.x + (Math.random() - 0.5) * 1.2;
        const newY = prev.y + (Math.random() - 0.5) * 1.2;
        const dist = Math.sqrt(newX**2 + newY**2);
        return { x: newX, y: newY, distance: Math.round(dist) };
      });

      // 2. Collision Detection Logic (Microprocessor role)
      const totalAccel = Math.sqrt(accelX**2 + accelY**2 + (accelZ-1)**2);
      
      // Fail-safe: Local sensor always has priority over network data
      const localDetection = totalAccel > COLLISION_THRESHOLD;
      setIsFailSafeActive(localDetection);

      // Impact detection (G-force)
      if (localDetection) {
        handleCollision(newData);
      }

      // Pre-collision warning (Distance via V2X)
      const isClose = vehicleBPos.distance < WARNING_DISTANCE;
      if (isClose && !isSimulatingCollision) {
        setEventStatus('WARNING');
        setActiveAlert(true);
      } else if (!isSimulatingCollision && totalAccel <= COLLISION_THRESHOLD) {
        setEventStatus('NORMAL');
        setActiveAlert(false);
      }

      // 3. V2X DSRC Heartbeat
      if (timestamp % 1000 < 200) { // Every ~1s
        broadcastMessage('HEARTBEAT', newData);
      }

    }, 200 / simulationSpeed);

    return () => clearInterval(interval);
  }, [isSimulating, currentData, simulationSpeed]);

  const broadcastMessage = (type: V2XMessage['type'], data: SensorData) => {
    const messageId = Math.random().toString(36).substring(7);
    const timestamp = Date.now();
    
    // Simulate ECDSA Digital Signature
    // In a real system, this would use a private key stored in the vehicle's HSM (Hardware Security Module)
    const signature = "SIG_" + Math.random().toString(36).substring(7);
    const publicKey = "PUB_VEHICLE_01_" + Math.random().toString(36).substring(7);

    const newMessage: V2XMessage = {
      id: messageId,
      senderId: "VEHICLE_01",
      timestamp,
      type,
      eventType: eventStatus,
      data,
      hash: "HASH_" + Math.random().toString(36).substring(7),
      signature,
      publicKey,
      isVerified: true // Verified by receiving nodes/RSUs
    };

    setV2xMessages(prev => [newMessage, ...prev.slice(0, 9)]);
    setPendingMessages(prev => [...prev, newMessage]);
  };

  const handleCollision = (data: SensorData) => {
    setActiveAlert(true);
    broadcastMessage('COLLISION_ALERT', data);
    setTimeout(() => setActiveAlert(false), 3000);
  };

  const triggerCollision = () => {
    if (isSimulatingCollision) return;
    setIsSimulatingCollision(true);
    setIsSimulating(true);
    setEventStatus('WARNING');

    // Step 1: Approach Animation (2 vehicles moving towards each other)
    let progress = 0;
    const approachInterval = setInterval(() => {
      progress += 0.05;
      const dist = Math.max(0, 150 * (1 - progress));
      setVehicleBPos({ x: dist * 0.6, y: -dist * 0.8, distance: Math.round(dist) });
      
      if (dist < 2) setEventStatus('WARNING');

      if (progress >= 1) {
        clearInterval(approachInterval);
        executeImpact();
      }
    }, 100);

    const executeImpact = () => {
      setEventStatus('ACCIDENT');
      const timestamp = Date.now();
      const collisionData: SensorData = {
        timestamp,
        accelX: 9.8, // Extreme impact
        accelY: -5.5,
        accelZ: 3.2,
        heading: (currentData?.heading || 0),
        lat: 21.0285,
        lng: 105.8542,
        vehicleId: "VEHICLE_01"
      };

      setCurrentData(collisionData);
      setSensorData(prev => [...prev.slice(-19), collisionData]);
      setVehicleBPos({ x: 0, y: 0, distance: 0 });
      
      setActiveAlert(true);
      
      // V2X: Warning sent to nearby vehicles
      broadcastMessage('COLLISION_ALERT', collisionData);
      
      // Immediate Blockchain Accident Block
      const lastBlock = blockchain[blockchain.length - 1];
      const accidentBlock: Block = {
        index: blockchain.length,
        timestamp: Date.now(),
        messages: [{
          id: "ACCIDENT_EVENT_" + Math.random().toString(36).substring(2, 15),
          senderId: "VEHICLE_ID: V_01",
          timestamp: Date.now(),
          type: 'COLLISION_ALERT',
          eventType: 'ACCIDENT',
          data: collisionData,
          hash: "ACCIDENT_VERIFIED_BY_RSU"
        }],
        previousHash: lastBlock?.hash || "0",
        hash: "ACCIDENT_BLOCK_" + Math.random().toString(36).substring(2, 15),
        nonce: 777
      };
      
      setBlockchain(prev => {
        const next = [...prev, accidentBlock];
        persistBlock(accidentBlock);
        return next;
      });

      setTimeout(() => {
        setIsSimulatingCollision(false);
        setActiveAlert(false);
        setEventStatus('NORMAL');
      }, 5000);
    };
  };

  // Blockchain Mining Logic
  useEffect(() => {
    if (pendingMessages.length >= BLOCK_SIZE && blockchain.length > 0) {
      const lastBlock = blockchain[blockchain.length - 1];
      const txTime = (Math.random() * 1.5 + 1.5).toFixed(1);
      setBlockchainTxTime(Number(txTime));

      const newBlock: Block = {
        index: blockchain.length,
        timestamp: Date.now(),
        messages: [...pendingMessages],
        previousHash: lastBlock?.hash || "0",
        hash: "block_hash_" + Math.random().toString(36).substring(2, 15),
        nonce: Math.floor(Math.random() * 1000)
      };
      
      setBlockchain(prev => {
        const next = [...prev, newBlock];
        persistBlock(newBlock);
        return next;
      });
      setPendingMessages([]);
    }
  }, [pendingMessages, blockchain]);

  const runScenario = (id: number) => {
    setCurrentScenario(id);
    setScenarioStep(1);
    setIsSimulating(true);
    setCapturedSnapshot(null);

    if (id === 1) {
      setScenarioExplanation("Phương tiện di chuyển ổn định trên lộ trình, khoảng cách an toàn d > 20m.");
      setScenarioMechanism("Cơ chế Heartbeat: OBU liên tục phát gói tin BSM (Basic Safety Message) định kỳ 10Hz.");
      setPreventionMeasure("Dữ liệu: Lưu trữ 'Lightweight Log' (nhật ký nhẹ) lên Blockchain để tiết kiệm tài nguyên nhưng vẫn đảm bảo theo dõi được hành trình.");
      
      setTimeout(() => {
        setScenarioStep(2);
        setScenarioExplanation("Hệ thống xác nhận kết nối tốt. Các gói tin BSM được gửi đi đều đặn.");
      }, 3000);

      setTimeout(() => {
        setScenarioStep(3);
        setScenarioExplanation("Chụp ảnh nhật ký: Ghi lại hành trình bình thường.");
        setCapturedSnapshot({
          type: 'NORMAL_DRIVING',
          accel: currentData?.accelX.toFixed(2),
          heading: currentData?.heading.toFixed(1),
          v2x: 'HEARTBEAT_ACTIVE'
        });
      }, 5000);

      setTimeout(() => {
        setScenarioStep(4);
        setScenarioExplanation("Dữ liệu được nén và ghi vào Blockchain dưới dạng Lightweight Log.");
      }, 8000);

      setTimeout(() => {
        const snapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 1,
          name: "Kịch bản 1: Lái xe bình thường (Normal Driving)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            accel: `${currentData?.accelX.toFixed(2)}G`,
            heading: `${currentData?.heading.toFixed(1)}°`,
            v2x: "Heartbeat 10Hz"
          },
          status: "SUCCESS"
        };
        setScenarioHistory(prev => [snapshot, ...prev]);
        persistReport(snapshot);
        setCurrentScenario(null);
        setScenarioExplanation("");
        setScenarioMechanism("");
        setPreventionMeasure("");
      }, 12000);
    } else if (id === 2) {
      setScenarioExplanation("Xe B tiến lại gần xe A trong phạm vi d < 2m (theo tỉ lệ mô phỏng).");
      setScenarioMechanism("Thuật toán Euclide: Vi xử lý tính toán khoảng cách d = sqrt((x2-x1)^2 + (y2-y1)^2) thời gian thực.");
      setPreventionMeasure("Ưu tiên V2X: Khi d vi phạm ngưỡng, hệ thống kích hoạt V2X Radar nhấp nháy đỏ và phát âm thanh cảnh báo (Audio Alert) để tài xế kịp thời xử lý.");
      setVehicleBPos({ x: 30, y: -40, distance: 50 });
      
      setTimeout(() => {
        setScenarioStep(2);
        setScenarioExplanation("Khoảng cách d vi phạm ngưỡng an toàn (< 2m).");
        setVehicleBPos({ x: 1, y: 1, distance: 1.5 });
        setEventStatus('WARNING');
        setActiveAlert(true);
      }, 4000);

      setTimeout(() => {
        setScenarioStep(3);
        setScenarioExplanation("Chụp ảnh cảnh báo: Kích hoạt Audio Alert và Radar đỏ.");
        setCapturedSnapshot({
          type: 'PRE_COLLISION',
          distance: '1.5m',
          alert: 'AUDIO_VISUAL_ACTIVE',
          action: 'DRIVER_NOTIFIED'
        });
      }, 6000);
      
      setTimeout(() => {
        setScenarioStep(4);
        setScenarioExplanation("Thông điệp cảnh báo được ưu tiên truyền qua kênh V2X để báo động xe xung quanh.");
        broadcastMessage('DISTANT_WARNING', currentData!);
      }, 8500);

      setTimeout(() => {
        const snapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 2,
          name: "Kịch bản 2: Cảnh báo tiền va chạm (Pre-collision Warning)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            distance: "< 2m",
            algorithm: "Euclidean Distance",
            alert: "Audio/Visual Active"
          },
          status: "SUCCESS"
        };
        setScenarioHistory(prev => [snapshot, ...prev]);
        persistReport(snapshot);
        setCurrentScenario(null);
        setScenarioExplanation("");
        setScenarioMechanism("");
        setPreventionMeasure("");
        setEventStatus('NORMAL');
        setActiveAlert(false);
        setVehicleBPos({ x: 40, y: -60, distance: 72 });
      }, 12000);
    } else if (id === 3) {
      setScenarioExplanation("Xảy ra va chạm vật lý mạnh (A > 2.5g).");
      setScenarioMechanism("Snapshot tức thời: Ngay khi MPU6050 kích hoạt ngắt (Interrupt), hệ thống 'khóa' dữ liệu GPS và thời gian tại giây đó.");
      setPreventionMeasure("Accident Block: Tạo một khối dữ liệu riêng biệt (Red Block) ghi trực tiếp lên Blockchain. Dữ liệu này có dấu thời gian (Timestamp) tuyệt đối, không thể sửa đổi, dùng làm bằng chứng pháp lý.");
      triggerCollision();
      
      setTimeout(() => {
        setScenarioStep(2);
        setScenarioExplanation("VA CHẠM XẢY RA! MPU6050 kích hoạt ngắt. Toàn bộ dữ liệu tọa độ và thời gian bị khóa.");
        setCapturedSnapshot({
          type: 'ACCIDENT_BLOCK',
          impact: '9.8G',
          locked_gps: '21.0285, 105.8542',
          locked_time: new Date().toLocaleTimeString(),
          blockchain: 'RED_BLOCK_PENDING'
        });
      }, 2500);

      setTimeout(() => {
        setScenarioStep(3);
        setScenarioExplanation("Dữ liệu va chạm được đóng gói với dấu thời gian tuyệt đối.");
      }, 5500);

      setTimeout(() => {
        setScenarioStep(4);
        setScenarioExplanation("Accident Block đã được ghi vào Blockchain. Bằng chứng không thể sửa đổi.");
      }, 9000);

      setTimeout(() => {
        const snapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 3,
          name: "Kịch bản 3: Va chạm & Chốt bằng chứng (Collision & Logging)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            impact: "> 2.5G",
            snapshot: "GPS/Time Locked",
            blockchain: "Accident Block Created"
          },
          status: "SUCCESS"
        };
        setScenarioHistory(prev => [snapshot, ...prev]);
        persistReport(snapshot);
        setCurrentScenario(null);
        setScenarioExplanation("");
        setScenarioMechanism("");
        setPreventionMeasure("");
      }, 13000);
    } else if (id === 4) {
      setScenarioExplanation("Một kẻ tấn công dùng ID giả để gửi thông tin tắc đường/tai nạn ảo.");
      setScenarioMechanism("Định danh số (Digital ID): Mỗi xe có một ID duy nhất được lưu trong danh sách trắng (Whitelist) của hệ thống.");
      setPreventionMeasure("Xác thực PBFT: 5 nút RSU thực hiện đồng thuận. Nếu gói tin không có chữ ký số hợp lệ hoặc ID không tồn tại, hệ thống sẽ Từ chối (Reject) và không ghi vào chuỗi.");
      setScenarioStep(1);
      
      setTimeout(() => {
        setScenarioStep(2);
        setScenarioExplanation("Hệ thống kiểm tra ID và chữ ký số. Phát hiện ID không có trong Whitelist.");
        setNodeStatus(['online', 'attacked', 'online', 'online', 'online']);
      }, 3000);

      setTimeout(() => {
        setScenarioStep(3);
        setScenarioExplanation("Chụp ảnh tấn công: Từ chối gói tin từ ID giả mạo.");
        setCapturedSnapshot({
          type: 'SYBIL_ATTACK_DETECTED',
          node: 'RSU_02',
          id: 'FAKE_ID_0x88',
          action: 'REJECTED'
        });
      }, 5000);

      setTimeout(() => {
        setScenarioStep(4);
        setScenarioExplanation("Đồng thuận PBFT thất bại cho gói tin giả. Hệ thống không ghi dữ liệu này vào chuỗi.");
      }, 8500);

      setTimeout(() => {
        const snapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 4,
          name: "Kịch bản 4: Tấn công giả mạo (Sybil Attack)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            attack: "Sybil Detected",
            id_check: "Failed (Not in Whitelist)",
            consensus: "PBFT Rejected"
          },
          status: "SUCCESS"
        };
        setScenarioHistory(prev => [snapshot, ...prev]);
        persistReport(snapshot);
        setCurrentScenario(null);
        setScenarioExplanation("");
        setScenarioMechanism("");
        setPreventionMeasure("");
        setNodeStatus(['online', 'online', 'online', 'online', 'online']);
      }, 13000);
    } else if (id === 5) {
      setScenarioExplanation("Kẻ xấu can thiệp gói tin V2X để sửa vị trí xe trên đường truyền.");
      setScenarioMechanism("Hàm Hash SHA-256: Toàn bộ dữ liệu được băm thành một mã Hash duy nhất trước khi gửi.");
      setPreventionMeasure("Kiểm tra tính toàn vẹn: Khi nhận tin, RSU tính lại mã Hash. Nếu mã Hash không khớp (do dữ liệu bị sửa), gói tin bị hủy ngay lập tức.");
      setScenarioStep(1);
      
      setTimeout(() => {
        setScenarioStep(2);
        setScenarioExplanation("RSU nhận gói tin và thực hiện tính toán lại mã Hash SHA-256.");
        setNodeStatus(['online', 'online', 'attacked', 'online', 'online']);
      }, 3000);

      setTimeout(() => {
        setScenarioStep(3);
        setScenarioExplanation("Chụp ảnh tấn công: Phát hiện sai lệch mã Hash (Data Tampered).");
        setCapturedSnapshot({
          type: 'INTEGRITY_VIOLATION',
          received_hash: '0x...ABC',
          calculated_hash: '0x...XYZ',
          status: 'TAMPERED'
        });
      }, 5000);

      setTimeout(() => {
        setScenarioStep(4);
        setScenarioExplanation("Gói tin bị hủy bỏ. Dữ liệu sai lệch không được chấp nhận vào hệ thống.");
      }, 8500);

      setTimeout(() => {
        const snapshot = {
          id: Date.now() + Math.random(),
          scenarioId: 5,
          name: "Kịch bản 5: Tấn công thay đổi dữ liệu (Data Integrity)",
          timestamp: new Date().toLocaleTimeString(),
          data: {
            attack: "Data Tampering",
            hash_check: "Mismatch (SHA-256)",
            action: "Packet Dropped"
          },
          status: "SUCCESS"
        };
        setScenarioHistory(prev => [snapshot, ...prev]);
        persistReport(snapshot);
        setCurrentScenario(null);
        setScenarioExplanation("");
        setScenarioMechanism("");
        setPreventionMeasure("");
        setNodeStatus(['online', 'online', 'online', 'online', 'online']);
      }, 13000);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-slate-100 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Shield className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-white">V2X-Blockchain Simulation</h1>
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">NCKH: Collision Warning System</p>
            </div>
          </div>

          {/* Latency Indicators */}
          <div className="flex items-center gap-2 md:gap-4 bg-white/5 px-3 md:px-4 py-1.5 md:py-2 rounded-xl border border-white/10">
            <div className="flex flex-col items-center">
              <span className="text-[7px] md:text-[8px] text-slate-500 uppercase tracking-widest">V2X Latency</span>
              <span className="text-[10px] md:text-xs font-mono text-emerald-400">{v2xLatency}ms</span>
            </div>
            <div className="w-px h-5 md:h-6 bg-white/10"></div>
            <div className="flex flex-col items-center">
              <span className="text-[7px] md:text-[8px] text-slate-500 uppercase tracking-widest">Blockchain TX</span>
              <span className="text-[10px] md:text-xs font-mono text-blue-400">{blockchainTxTime}s</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Sync Status */}
            {user && isSyncing && (
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Syncing...</span>
              </div>
            )}

            {/* User Auth */}
            {user ? (
              <div className="flex items-center gap-3 pl-4 border-l border-white/10">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] font-bold text-white leading-none">{user.displayName || 'User'}</span>
                  <span className="text-[8px] text-slate-400 uppercase font-bold tracking-widest">Connected</span>
                </div>
                <button 
                  onClick={logout}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/10 text-slate-400 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/20 transition-all shadow-sm"
                  title="Đăng xuất"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={async () => {
                  if (isLoggingIn) return;
                  setIsLoggingIn(true);
                  try {
                    await loginWithGoogle();
                  } catch (err: any) {
                    if (err.code !== 'auth/cancelled-popup-request') {
                      console.error("Login failed:", err);
                    }
                  } finally {
                    setIsLoggingIn(false);
                  }
                }}
                disabled={isLoggingIn}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg active:scale-95",
                  isLoggingIn 
                    ? "bg-slate-700 text-slate-400 cursor-wait" 
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-500/20"
                )}
              >
                {isLoggingIn ? (
                  <div className="w-4 h-4 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                {isLoggingIn ? "Đang kết nối..." : "Kết nối Database"}
              </button>
            )}

            {/* Event Status Badge */}
            <div className={cn(
              "px-3 py-1 rounded-full text-[9px] font-bold border flex items-center gap-1.5 transition-all duration-500",
              eventStatus === 'NORMAL' && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
              eventStatus === 'WARNING' && "bg-orange-500/10 text-orange-400 border-orange-500/20 animate-pulse",
              eventStatus === 'ACCIDENT' && "bg-red-500/20 text-red-500 border-red-500/50"
            )}>
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                eventStatus === 'NORMAL' && "bg-emerald-500",
                eventStatus === 'WARNING' && "bg-orange-500",
                eventStatus === 'ACCIDENT' && "bg-red-500"
              )} />
              STATUS: {eventStatus}
            </div>

            <button 
              onClick={triggerCollision}
              disabled={isSimulatingCollision}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-2 border",
                isSimulatingCollision 
                  ? "bg-red-500/20 text-red-500 border-red-500/50 animate-pulse" 
                  : "bg-orange-500/10 text-orange-400 border-orange-500/20 hover:bg-orange-500 hover:text-black"
              )}
            >
              <AlertTriangle className="w-3 h-3" />
              {isSimulatingCollision ? "Đang Va Chạm!" : "Giả Lập Va Chạm"}
            </button>

            <div className="flex bg-white/5 rounded-lg p-1 border border-white/10">
              <button 
                onClick={() => setIsSimulating(!isSimulating)}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-2",
                  isSimulating ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-emerald-500 text-black hover:bg-emerald-400"
                )}
              >
                {isSimulating ? <Zap className="w-3 h-3 fill-current" /> : <Activity className="w-3 h-3" />}
                {isSimulating ? "Dừng Mô Phỏng" : "Bắt Đầu Mô Phỏng"}
              </button>
            </div>
            <select 
              value={simulationSpeed} 
              onChange={(e) => setSimulationSpeed(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/50"
            >
              <option value={0.5}>0.5x Speed</option>
              <option value={1}>1.0x Speed</option>
              <option value={2}>2.0x Speed</option>
            </select>
          </div>
        </div>
      </header>

      {/* Scenario Explanation Overlay */}
      <AnimatePresence>
        {currentScenario && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] w-full max-w-2xl px-6"
          >
            <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 shadow-2xl shadow-emerald-500/10">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-wider">Đang chạy Kịch bản {currentScenario}</h4>
                    <p className="text-[10px] text-emerald-400 font-mono font-bold">Bước {scenarioStep} / 4</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setCurrentScenario(null); setScenarioExplanation(""); }}
                  className="text-slate-500 hover:text-white transition-colors"
                >
                  Dừng
                </button>
              </div>
              {preventionMeasure && (
                <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5" />
                  <div>
                    <p className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest mb-0.5">Biện pháp đề phòng chủ động</p>
                    <p className="text-[11px] text-slate-200 font-medium">{preventionMeasure}</p>
                  </div>
                </div>
              )}
              <div className="bg-white/5 rounded-xl p-4 border border-white/5 mb-4">
                <p className="text-sm text-slate-300 leading-relaxed italic">
                  "{scenarioExplanation}"
                </p>
              </div>

              {scenarioMechanism && (
                <div className="mb-4 p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    <h5 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Cơ chế hệ thống</h5>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium">{scenarioMechanism}</p>
                </div>
              )}

              {/* Simulated Screenshot / Snapshot */}
              <AnimatePresence>
                {capturedSnapshot && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mb-4 relative group"
                  >
                    <div className="absolute -top-2 -right-2 z-10 bg-emerald-500 text-black text-[8px] font-bold px-2 py-0.5 rounded-full shadow-lg">
                      SNAPSHOT CAPTURED
                    </div>
                    <div className="bg-black/40 border-2 border-emerald-500/30 rounded-xl p-4 overflow-hidden relative shadow-inner">
                      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent pointer-events-none"></div>
                      <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                          <span className="text-[10px] font-mono text-slate-500">IMG_DATA_01.RAW</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{new Date().toLocaleTimeString()}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {Object.entries(capturedSnapshot).map(([key, value]) => (
                          key !== 'type' && (
                            <div key={key} className="bg-white/5 p-2 rounded-lg border border-white/5">
                              <p className="text-[8px] text-slate-500 uppercase tracking-tighter">{key}</p>
                              <p className="text-xs font-mono text-emerald-400">{String(value)}</p>
                            </div>
                          )
                        ))}
                      </div>
                      
                      <div className="mt-3 pt-2 border-t border-white/5 flex justify-between items-center">
                        <span className="text-[8px] text-slate-500 font-mono">ENCRYPTION: AES-256</span>
                        <span className="text-[8px] text-slate-500 font-mono">SIG: VERIFIED</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="mt-4 flex gap-1">
                {[1, 2, 3, 4].map((i) => (
                  <div 
                    key={i} 
                    className={cn(
                      "h-1 flex-1 rounded-full transition-all duration-500",
                      i <= scenarioStep ? "bg-emerald-500" : "bg-white/10"
                    )}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-6">
        
        {/* Left Column: Sensors & Real-time Data */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          
          {/* Dashboard Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard 
              icon={<Cpu className="w-4 h-4" />} 
              label="MPU6050 Acceleration" 
              value={`${currentData?.accelX.toFixed(2) || '0.00'} G`} 
              subValue="X-Axis Real-time"
              color="emerald"
            />
            <StatCard 
              icon={
                <motion.div
                  animate={{ rotate: currentData?.heading || 0 }}
                  transition={{ type: "spring", stiffness: 50, damping: 10 }}
                >
                  <Navigation className="w-4 h-4" />
                </motion.div>
              } 
              label="Phương chiều (Heading)" 
              value={`${currentData?.heading.toFixed(1) || '0.0'}°`} 
              subValue="Góc hướng GPS M10N"
              color="blue"
            />
            <StatCard 
              icon={<MapPin className="w-4 h-4" />} 
              label="Coordinates" 
              value={`${currentData?.lat.toFixed(4) || '0.0'}, ${currentData?.lng.toFixed(4) || '0.0'}`} 
              subValue="GPS Location"
              color="violet"
            />
            <StatCard 
              icon={<Database className={cn("w-4 h-4", user ? "text-emerald-400" : "text-amber-400")} />} 
              label="Cloud Database" 
              value={user ? "Connected" : "Disconnected"} 
              subValue={user ? "Firestore Active" : "Click connect in header"}
              color={user ? "emerald" : "amber"}
            />
            <StatCard 
              icon={<ShieldCheck className="w-4 h-4" />} 
              label="System Resilience" 
              value="OPTIMAL" 
              subValue="Network Sync"
              color="emerald"
            />
            <StatCard 
              icon={<Radio className="w-4 h-4" />} 
              label="V2X STATUS" 
              value="DSRC Active" 
              subValue="5.9 GHz Band"
              color="amber"
            />
          </div>

          {/* NCKH Control Toolbox */}
          <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 shadow-xl shadow-black/20 overflow-hidden relative group">
            <div className="absolute top-0 right-0 p-6 opacity-5 rotate-12 group-hover:rotate-0 transition-transform">
              <Layers className="w-24 h-24 text-blue-500" />
            </div>
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    NCKH Control Toolbox
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Công cụ nén & đẩy dữ liệu mô phỏng trực tiếp</p>
                </div>
                <div className="flex items-center gap-2">
                   <div className="px-2 py-0.5 rounded border border-blue-500/20 bg-blue-500/5 text-blue-400 text-[8px] font-bold">MODE: MANUAL_DATA</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                {/* Manual Send Button */}
                <button 
                  onClick={sendManualSimulationData}
                  disabled={isSendingManualData || !user}
                  className={cn(
                    "flex-1 min-w-[200px] flex items-center justify-center gap-3 px-6 py-4 rounded-xl border font-bold transition-all active:scale-95",
                    user 
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-black cursor-pointer shadow-lg shadow-emerald-500/10" 
                      : "bg-white/5 border-white/5 text-slate-600 cursor-not-allowed"
                  )}
                >
                  {isSendingManualData ? (
                    <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Share2 className="w-5 h-5" />
                  )}
                  <div className="text-left">
                    <p className="text-xs uppercase tracking-wider leading-none mb-1">Gửi dữ liệu mô phỏng</p>
                    <p className="text-[9px] font-medium opacity-60">Push to reports collection</p>
                  </div>
                </button>

                {/* DB Export Button */}
                <button 
                  onClick={exportFromFirestore}
                  disabled={isExportingDB || !user}
                  className={cn(
                    "flex-1 min-w-[200px] flex items-center justify-center gap-3 px-6 py-4 rounded-xl border font-bold transition-all active:scale-95",
                    user 
                      ? "bg-blue-500/10 border-blue-500/20 text-blue-400 hover:bg-blue-50 hover:text-black cursor-pointer shadow-lg shadow-blue-500/10" 
                      : "bg-white/5 border-white/5 text-slate-600 cursor-not-allowed"
                  )}
                >
                  {isExportingDB ? (
                    <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Download className="w-5 h-5" />
                  )}
                  <div className="text-left">
                    <p className="text-xs uppercase tracking-wider leading-none mb-1">Xuất báo cáo Excel</p>
                    <p className="text-[9px] font-medium opacity-60">Fetch from Firestore Database</p>
                  </div>
                </button>
              </div>
              
              {!user && (
                <div className="mt-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-center gap-3">
                  <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <p className="text-[10px] text-amber-200/70 font-medium">Bạn cần nhấn <strong className="text-amber-400">"Kết nối Database"</strong> ở trên cùng để sử dụng các tính năng đẩy dữ liệu NCKH này.</p>
                </div>
              )}
            </div>
          </div>

          {/* Radar & Charts Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Radar / Mini-map */}
            <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 flex flex-col items-center justify-center relative overflow-hidden group shadow-xl shadow-black/20">
              <div className="absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              
              {/* Road Background (Simulated) */}
              <div className="absolute inset-0 opacity-10 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-10 bg-white/5 -translate-y-1/2"></div>
                <div className="absolute top-1/2 left-0 right-0 h-px border-t border-dashed border-white/10 -translate-y-1/2"></div>
                <div className="absolute left-1/2 top-0 bottom-0 w-10 bg-white/5 -translate-x-1/2"></div>
                <div className="absolute left-1/2 top-0 bottom-0 w-px border-l border-dashed border-white/10 -translate-x-1/2"></div>
              </div>

              <h3 className="text-xs font-black text-slate-500 mb-4 flex items-center justify-between w-full z-10">
                <span className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-emerald-400" />
                  V2X Radar (Mini-map)
                </span>
                <span className="text-[8px] bg-emerald-500/20 text-emerald-400 px-1 rounded border border-emerald-500/40">LIVE</span>
              </h3>
              
              <div className="absolute top-12 right-6 flex flex-col items-end gap-1 z-10">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                  <span className="text-[8px] text-slate-400 uppercase font-mono tracking-tighter">Warning: &lt;2m</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                  <span className="text-[8px] text-slate-400 uppercase font-mono tracking-tighter">Impact: &gt;2.5G</span>
                </div>
              </div>
              
              <div className="relative w-48 h-48 rounded-full border border-white/5 flex items-center justify-center bg-white/[0.02] backdrop-blur-sm shadow-inner">
                {/* Radar Rings */}
                <div className="absolute w-32 h-32 rounded-full border border-white/5"></div>
                <div className="absolute w-16 h-16 rounded-full border border-white/5"></div>
                
                {/* Radar Sweep */}
                <motion.div 
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-emerald-500/5 to-transparent origin-center"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                />

                {/* Vehicle A (Center) */}
                <div className={cn(
                  "relative z-20 w-4 h-4 rounded-full shadow-lg transition-colors duration-300",
                  activeAlert ? "bg-red-500 shadow-red-500/50 animate-pulse" : "bg-emerald-500 shadow-emerald-500/50"
                )}>
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white whitespace-nowrap bg-black/60 shadow-xl border border-white/10 px-1 rounded">Xe A (Chủ)</span>
                </div>

                {/* Vehicle B (Remote) */}
                <motion.div 
                  className={cn(
                    "absolute z-20 w-3 h-3 rounded-full shadow-lg",
                    isSimulatingCollision ? "bg-red-600 shadow-red-600/50" : "bg-blue-500 shadow-blue-500/50"
                  )}
                  animate={{ 
                    x: isSimulatingCollision ? 0 : vehicleBPos.x, 
                    y: isSimulatingCollision ? 0 : vehicleBPos.y,
                    scale: isSimulatingCollision ? [1, 1.5, 1] : 1
                  }}
                  transition={{ 
                    type: "spring", 
                    stiffness: isSimulatingCollision ? 200 : 50,
                    scale: { repeat: isSimulatingCollision ? Infinity : 0, duration: 0.5 }
                  }}
                >
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[8px] font-bold text-blue-400 whitespace-nowrap bg-black/60 shadow-xl border border-white/10 px-1 rounded">
                    {isSimulatingCollision ? "VA CHẠM!" : `Xe B (${vehicleBPos.distance}m)`}
                  </span>
                </motion.div>

                {/* Vehicle C (Remote) */}
                <motion.div 
                  className="absolute z-20 w-3 h-3 rounded-full shadow-lg bg-indigo-500 shadow-indigo-500/50"
                  animate={{ 
                    x: vehicleCPos.x, 
                    y: vehicleCPos.y
                  }}
                  transition={{ type: "spring", stiffness: 50 }}
                >
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[8px] font-bold text-indigo-400 whitespace-nowrap bg-black/60 shadow-xl border border-white/10 px-1 rounded">
                    Xe C ({vehicleCPos.distance}m)
                  </span>
                </motion.div>

                {/* Vehicle D (Remote) */}
                <motion.div 
                  className="absolute z-20 w-3 h-3 rounded-full shadow-lg bg-cyan-500 shadow-cyan-500/50"
                  animate={{ 
                    x: vehicleDPos.x, 
                    y: vehicleDPos.y
                  }}
                  transition={{ type: "spring", stiffness: 50 }}
                >
                  <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[8px] font-bold text-cyan-400 whitespace-nowrap bg-black/60 shadow-xl border border-white/10 px-1 rounded">
                    Xe D ({vehicleDPos.distance}m)
                  </span>
                </motion.div>
              </div>
              
              <div className="mt-4 flex items-center gap-4 text-[10px] text-slate-500 font-mono z-10">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span>Xe A</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                  <span>Xe B</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                  <span>Xe C</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
                  <span>Xe D</span>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 shadow-xl shadow-black/20">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-medium text-slate-400 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-400" />
                  Biểu đồ Gia tốc (MPU6050)
                </h3>
                <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded font-bold">G-Force (m/s²)</span>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sensorData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" vertical={false} />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis domain={[-4, 4]} stroke="#475569" fontSize={10} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1a1a1e', border: '1px solid #2a2a2e', borderRadius: '8px', fontSize: '10px', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)' }}
                      itemStyle={{ color: '#10b981' }}
                    />
                    <Line type="monotone" dataKey="accelX" stroke="#10b981" strokeWidth={2} dot={false} animationDuration={300} />
                    <Line type="monotone" dataKey="accelY" stroke="#3b82f6" strokeWidth={1} dot={false} animationDuration={300} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* V2X Message Feed */}
          <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-amber-500" />
                Luồng dữ liệu V2X (DSRC)
              </h3>
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] text-emerald-500/80 font-mono font-bold">BROADCASTING...</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {v2xMessages.map((msg) => (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className={cn(
                      "p-3 rounded-xl border flex items-center justify-between shadow-xl shadow-black/10 transition-all",
                      msg.type === 'COLLISION_ALERT' 
                        ? "bg-red-500/10 border-red-500/20" 
                        : "bg-white/5 border-white/5"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        msg.type === 'COLLISION_ALERT' ? "bg-red-500/20" : "bg-white/5"
                      )}>
                        {msg.type === 'COLLISION_ALERT' ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <Radio className="w-4 h-4 text-slate-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className={cn(
                            "text-xs font-bold",
                            msg.type === 'COLLISION_ALERT' ? "text-red-400" : "text-slate-200"
                          )}>
                            {msg.type === 'COLLISION_ALERT' ? "CẢNH BÁO VA CHẠM" : "Dữ liệu định kỳ (Heartbeat)"}
                          </p>
                          <span className={cn(
                            "text-[7px] px-1 rounded border flex items-center gap-0.5 font-bold uppercase",
                            msg.isVerified !== false 
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                              : "bg-red-500/10 text-red-500 border-red-500/20"
                          )}>
                            {msg.isVerified !== false ? <ShieldCheck className="w-2 h-2" /> : <Lock className="w-2 h-2" />}
                            {msg.isVerified !== false ? "Signature Verified" : "INVALID SIGNATURE"}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono">ID: {msg.id} | Hash: {msg.hash.substring(0, 16)}...</p>
                        {msg.type === 'COLLISION_ALERT' && msg.isVerified !== false && (
                          <p className="text-[9px] text-red-400 font-bold mt-1 animate-pulse flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" />
                            Warning sent to nearby vehicles
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 font-medium tracking-tight">H: {msg.data.heading.toFixed(1)}° | Lat: {msg.data.lat.toFixed(4)}</p>
                      <p className="text-[10px] text-slate-400">{new Date(msg.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
              {v2xMessages.length === 0 && (
                <div className="py-12 text-center text-slate-600 text-xs italic">
                  Chưa có thông điệp V2X nào được gửi...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Blockchain & Alerts */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          
          {/* Collision Alert Overlay */}
          <AnimatePresence>
            {activeAlert && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-red-600 rounded-2xl p-6 text-white shadow-2xl shadow-red-600/20 border border-red-400/30"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">NGUY CƠ VA CHẠM!</h2>
                    <p className="text-sm text-red-100">Phát hiện gia tốc đột ngột {currentData?.accelX.toFixed(2)}G</p>
                  </div>
                </div>
                <div className="bg-[#0a0a0c] rounded-lg p-3 text-xs font-mono border border-white/5 shadow-inner">
                  <p className="text-red-400 font-bold tracking-tight">STATUS: ALERT_SENT_V2X</p>
                  <p className="text-slate-400">PROTOCOL: DSRC_WAVE</p>
                  <p className="text-slate-400">BLOCKCHAIN: <span className="animate-pulse">RECORDING...</span></p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Network Consensus Panel */}
          <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 shadow-xl shadow-black/20">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Share2 className="w-3 h-3 text-blue-400" />
                Network Consensus (RSU)
              </h3>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] text-emerald-500/80 font-bold uppercase tracking-widest">Active</span>
              </div>
            </div>
            
            <div className="flex justify-between items-center gap-2">
              {[1, 2, 3, 4, 5].map((node, idx) => {
                const status = nodeStatus[idx];
                const isActive = pendingMessages.length > 0 || currentScenario !== null;
                
                // Determine color based on scenario or status
                let colorClass = "blue";
                if (status === 'attacked') colorClass = "red";
                else if (currentScenario === 1) colorClass = "emerald";
                else if (currentScenario === 2) colorClass = "amber";
                else if (currentScenario === 3) colorClass = "red";
                else if (currentScenario === 4) colorClass = "red";
                else if (currentScenario === 5) colorClass = "cyan";

                const colorStyles = {
                  blue: "bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)]",
                  emerald: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
                  amber: "bg-amber-500/10 border-amber-500/30 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]",
                  red: "bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]",
                  violet: "bg-violet-500/10 border-violet-500/30 text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.2)]",
                  cyan: "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]",
                };

                return (
                  <div key={node} className="flex flex-col items-center gap-2 group">
                    <div className={cn(
                      "w-10 h-10 rounded-xl border flex items-center justify-center transition-all duration-500 shadow-lg",
                      isActive 
                        ? `${colorStyles[colorClass as keyof typeof colorStyles]} animate-pulse` 
                        : "bg-white/5 border-white/5 hover:border-white/20"
                    )}>
                      <Radio className={cn(
                        "w-5 h-5 transition-colors duration-500",
                        isActive ? "" : "text-slate-600"
                      )} />
                    </div>
                    <span className={cn(
                      "text-[8px] font-bold transition-colors duration-500 tracking-tighter",
                      isActive ? "opacity-80" : "text-slate-600"
                    )}>RSU_0{node}</span>
                  </div>
                );
              })}
            </div>
            
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-500 uppercase font-bold tracking-tight">Consensus Protocol:</span>
                <span className="text-slate-400 font-mono">PBFT (Practical BFT)</span>
              </div>
              <div className="flex items-center justify-between text-[9px] mt-1">
                <span className="text-slate-500 uppercase font-bold tracking-tight">Validation Nodes:</span>
                <span className="text-slate-400 font-mono">{nodeStatus.filter(s => s === 'online').length}/5 Nodes Online</span>
              </div>
            </div>
          </div>

          {/* Blockchain Ledger */}
          <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-6 h-full shadow-xl shadow-black/20">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                Sổ cái Blockchain
              </h3>
              <div className="flex items-center gap-1 text-[8px] text-slate-500 font-bold uppercase tracking-widest">
                <Shield className="w-2 h-2 text-emerald-400" />
                Immune to Tampering
              </div>
            </div>

            <div className="space-y-4 relative">
              {/* Timeline line */}
              <div className="absolute left-[15px] top-4 bottom-4 w-px bg-white/5"></div>

              {blockchain.slice().reverse().map((block, idx) => {
                const isAccident = block.hash.toLowerCase().includes('accident');
                return (
                  <div key={`${block.hash}-${block.index}-${idx}`} className="relative pl-10 group">
                    <div className={cn(
                      "absolute left-0 top-1 w-8 h-8 rounded-lg border flex items-center justify-center z-10 shadow-xl transition-transform group-hover:scale-110",
                      isAccident ? "bg-red-500/20 border-red-500/40" : "bg-white/5 border-white/10"
                    )}>
                      {isAccident ? <AlertTriangle className="w-4 h-4 text-red-400" /> : <History className="w-4 h-4 text-emerald-400" />}
                    </div>
                    <div className={cn(
                      "bg-white/[0.03] border rounded-xl p-4 hover:bg-white/[0.05] transition-all group shadow-lg",
                      isAccident ? "border-red-500/30 bg-red-500/5 shadow-red-500/5" : "border-white/5"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded border shadow-inner",
                            isAccident ? "bg-red-500 text-white border-red-400" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          )}>
                            {isAccident ? 'ACCIDENT EVENT' : `BLOCK #${block.index}`}
                          </span>
                          <span className="text-[8px] text-emerald-400/80 font-bold flex items-center gap-0.5 opacity-60">
                            <ShieldCheck className="w-2 h-2" />
                            SECURED
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">{new Date(block.timestamp).toLocaleTimeString()}</span>
                      </div>
                      
                      {isAccident ? (
                        <div className="bg-black/20 border border-white/5 rounded-lg p-2.5 mb-2.5 space-y-1 font-mono text-[10px]">
                          <div className="text-red-400 font-bold mb-1 flex items-center gap-1.5 underline decoration-red-900">
                            <AlertTriangle className="w-3 h-3" />
                            GHI BLOCK RIÊNG:
                          </div>
                          <div className="space-y-1 opacity-70">
                            <div className="text-white"><span className="text-slate-500">Type:</span> Accident Event</div>
                            <div className="text-white"><span className="text-slate-500">Vehicle:</span> V_01 (Host)</div>
                            <div className="text-white"><span className="text-slate-500">GPS:</span> {block.messages[0].data.lat.toFixed(6)}, {block.messages[0].data.lng.toFixed(6)}</div>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-500 font-mono truncate mb-2 group-hover:text-slate-400">Hash: {block.hash}</p>
                      )}

                      <div className="flex items-center gap-2">
                        <div className="flex -space-x-2">
                          {block.messages.slice(0, 3).map((m, i) => (
                            <div key={i} className={cn(
                              "w-5 h-5 rounded-full border border-[#1a1a1e] flex items-center justify-center text-[8px] font-bold shadow-lg",
                              m.type === 'COLLISION_ALERT' ? "bg-red-500 text-white" : "bg-slate-700 text-slate-400"
                            )}>
                              {m.type === 'COLLISION_ALERT' ? "!" : "H"}
                            </div>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-500 group-hover:text-slate-400">
                          {block.messages.length} txs recorded
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Mining Progress */}
              {pendingMessages.length > 0 && (
                <div className="relative pl-10">
                  <div className="absolute left-0 top-1 w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center animate-pulse shadow-blue-500/5 shadow-xl">
                    <Zap className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="p-4 border border-dashed border-blue-500/20 rounded-xl bg-blue-500/5">
                    <div className="flex items-center justify-between mb-2">
                       <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest animate-pulse">Processing Block...</p>
                       <span className="text-[8px] text-blue-400/60 font-mono animate-pulse font-bold">RSU NODES VERIFYING</span>
                    </div>
                    <div className="w-full bg-blue-500/10 h-1.5 rounded-full overflow-hidden shadow-inner">
                      <motion.div 
                        className="bg-blue-500 h-full shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                        initial={{ width: 0 }}
                        animate={{ width: `${(pendingMessages.length / BLOCK_SIZE) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[9px] text-slate-500">{pendingMessages.length}/{BLOCK_SIZE} messages in queue</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="w-1 h-1 rounded-full bg-blue-500/40 animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* System Explanation & Test Scenarios Section */}
      <div className="max-w-7xl mx-auto px-6 mb-12 grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* System Explanation */}
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 relative overflow-hidden shadow-xl shadow-black/20">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <BookOpen className="w-32 h-32 text-emerald-400" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-emerald-400" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">Giải thích Hệ thống</h2>
            </div>
            
            <div className="space-y-6">
              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-xs font-bold text-emerald-400 border border-emerald-500/20">1</div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200 mb-1 uppercase tracking-wider">Cảm biến & Vi xử lý (Data Acquisition)</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium">
                    Hệ thống tích hợp cảm biến <strong className="text-slate-200">MPU6050</strong> (Gia tốc kế & Con quay hồi chuyển) để giám sát xung lực va chạm và <strong className="text-slate-200">GPS Holybro M10N</strong> để định vị. Vi xử lý trung tâm (ESP32/STM32) đóng vai trò là "bộ não", liên tục phân tích dữ liệu cảm biến với tần suất 100Hz để phát hiện các biến đổi bất thường vượt ngưỡng an toàn (ví dụ: {'>'} 2.5G).
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-bold text-blue-400 border border-blue-500/20">2</div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200 mb-1 uppercase tracking-wider">Giao tiếp V2X & Bảo mật (Communication Layer)</h3>
                  <p className="text-xs text-slate-400 leading-relaxed font-medium">
                    Sử dụng giao thức <strong className="text-slate-200">DSRC (Dedicated Short Range Communications)</strong> trên băng tần 5.9GHz. Để chống giả mạo, mỗi gói tin được ký số bằng thuật toán <strong className="text-slate-200">ECDSA</strong>. Khi xe A phanh gấp, nó gửi thông điệp cảnh báo đến xe B, C, D trong phạm vi 500m với độ trễ cực thấp, giúp các xe này phản ứng kịp thời trước khi va chạm xảy ra.
                  </p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center text-xs font-bold text-violet-400 border border-violet-500/20">3</div>
                <div>
                  <h3 className="text-sm font-bold text-slate-200 mb-1 uppercase tracking-wider">Blockchain & Đồng thuận RSU (Immutable Ledger)</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Các trạm <strong className="text-slate-200">RSU (Roadside Units)</strong> đóng vai trò là các nút xác thực trong mạng lưới Blockchain. Khi nhận được dữ liệu va chạm, các RSU thực hiện thuật toán đồng thuận <strong className="text-slate-200">PBFT (Practical Byzantine Fault Tolerance)</strong> để đảm bảo {'>'} 2/3 số nút đồng ý về tính xác thực của sự kiện. Sau đó, dữ liệu được băm (SHA-256) và ghi vào sổ cái bất biến, tạo ra bằng chứng pháp lý không thể chối cãi.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Test Scenarios */}
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 relative overflow-hidden shadow-xl shadow-black/20">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Terminal className="w-32 h-32 text-blue-400" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Terminal className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">II. CHI TIẾT CÁC KỊCH BẢN VÀ GIẢI PHÁP KỸ THUẬT</h2>
            </div>

            <div className="space-y-4">
              <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:border-blue-500/30 transition-colors group relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Kịch bản 1</span>
                  <button 
                    onClick={() => runScenario(1)}
                    className="text-[9px] bg-blue-600/20 text-blue-400 px-2 py-1 rounded border border-blue-600/30 hover:bg-blue-600 hover:text-white transition-all"
                  >
                    Chạy kịch bản
                  </button>
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">Kịch bản 1: Lái xe bình thường (Normal Driving)</h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  <strong className="text-slate-300">Mô tả:</strong> Phương tiện di chuyển ổn định trên lộ trình, khoảng cách an toàn $d {'>'} 20m$.<br/>
                  <strong className="text-slate-300">Vấn đề:</strong> Làm sao để hệ thống biết xe vẫn đang hoạt động bình thường và kết nối tốt?<br/>
                  <strong className="text-slate-300">Giải pháp:</strong> Cơ chế Heartbeat (BSM 10Hz) và lưu trữ "Lightweight Log" lên Blockchain.
                </p>
              </div>

              <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:border-amber-500/30 transition-colors group relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Kịch bản 2</span>
                  <button 
                    onClick={() => runScenario(2)}
                    className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-1 rounded border border-amber-500/30 hover:bg-amber-500 hover:text-black transition-all"
                  >
                    Chạy kịch bản
                  </button>
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">Kịch bản 2: Cảnh báo tiền va chạm (Pre-collision Warning)</h4>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <strong className="text-slate-300">Mô tả:</strong> Xe B tiến lại gần xe A trong phạm vi $d {'<'} 2m$ (theo tỉ lệ mô phỏng).<br/>
                  <strong className="text-slate-300">Vấn đề:</strong> Tài xế không kịp quan sát hoặc rơi vào điểm mù.<br/>
                  <strong className="text-slate-300">Giải pháp:</strong> Thuật toán Euclide tính khoảng cách thời gian thực và Ưu tiên V2X (Radar đỏ, Audio Alert).
                </p>
              </div>

              <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:border-red-500/30 transition-colors group relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-widest">Kịch bản 3</span>
                  <button 
                    onClick={() => runScenario(3)}
                    className="text-[9px] bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500 hover:text-black transition-all"
                  >
                    Chạy kịch bản
                  </button>
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">Kịch bản 3: Va chạm & Chốt bằng chứng (Collision & Logging)</h4>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <strong className="text-slate-300">Mô tả:</strong> Xảy ra va chạm vật lý mạnh ($A {'>'} 2.5g$).<br/>
                  <strong className="text-slate-300">Vấn đề:</strong> Các bên tranh cãi về lỗi vi phạm, tọa độ và thời gian sau tai nạn.<br/>
                  <strong className="text-slate-300">Giải pháp:</strong> Snapshot tức thời (MPU6050 Interrupt) và Accident Block (Red Block) trên Blockchain.
                </p>
              </div>

              <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:border-red-500/30 transition-colors group relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Kịch bản 4</span>
                  <button 
                    onClick={() => runScenario(4)}
                    className="text-[9px] bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30 hover:bg-red-500 hover:text-black transition-all"
                  >
                    Chạy kịch bản
                  </button>
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">Kịch bản 4: Tấn công giả mạo (Sybil Attack)</h4>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <strong className="text-slate-300">Mô tả:</strong> Một kẻ tấn công dùng ID giả để gửi thông tin tắc đường/tai nạn ảo.<br/>
                  <strong className="text-slate-300">Vấn đề:</strong> Làm nhiễu loạn giao thông và hệ thống điều hành.<br/>
                  <strong className="text-slate-300">Giải pháp:</strong> Định danh số (Digital ID/Whitelist) và Xác thực PBFT giữa 5 nút RSU.
                </p>
              </div>

              <div className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl hover:border-cyan-500/30 transition-colors group relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Kịch bản 5</span>
                  <button 
                    onClick={() => runScenario(5)}
                    className="text-[9px] bg-cyan-500/20 text-cyan-400 px-2 py-1 rounded border border-cyan-500/30 hover:bg-cyan-500 hover:text-black transition-all"
                  >
                    Chạy kịch bản
                  </button>
                </div>
                <h4 className="text-xs font-bold text-slate-200 mb-1">Kịch bản 5: Tấn công thay đổi dữ liệu (Data Integrity)</h4>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  <strong className="text-slate-300">Mô tả:</strong> Kẻ xấu can thiệp gói tin V2X để sửa vị trí xe trên đường truyền.<br/>
                  <strong className="text-slate-300">Vấn đề:</strong> Bằng chứng tai nạn bị làm sai lệch tọa độ.<br/>
                  <strong className="text-slate-300">Giải pháp:</strong> Hàm Hash SHA-256 và RSU kiểm tra tính toàn vẹn gói tin.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Security Layer Explanation */}
      <div className="max-w-7xl mx-auto px-6 mb-12">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 relative overflow-hidden shadow-xl shadow-black/20">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Lock className="w-48 h-48 text-blue-400" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight">Cơ chế Bảo mật & Chống Giả mạo</h2>
                <p className="text-sm text-slate-500 font-bold">Đảm bảo an toàn dữ liệu trong mạng lưới V2X-Blockchain</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white/5 p-5 rounded-2xl border border-white/5 shadow-sm hover:border-blue-500/30 transition-all">
                <div className="flex items-center gap-2 text-blue-400 mb-3">
                  <Lock className="w-4 h-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Chữ ký số ECDSA</h4>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                  Mỗi phương tiện sở hữu một cặp khóa (Private/Public Key). Mọi thông điệp gửi đi đều được ký bằng khóa riêng, đảm bảo tính xác thực và không thể chối bỏ.
                </p>
              </div>

              <div className="bg-white/5 p-5 rounded-2xl border border-white/5 shadow-sm hover:border-emerald-500/30 transition-all">
                <div className="flex items-center gap-2 text-emerald-400 mb-3">
                  <CheckCircle2 className="w-4 h-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Xác thực RSU</h4>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                  Các trạm RSU đóng vai trò là các nút kiểm chứng. Chúng kiểm tra chữ ký số của mọi gói tin V2X trước khi cho phép dữ liệu tham gia vào quá trình đồng thuận.
                </p>
              </div>

              <div className="bg-white/5 p-5 rounded-2xl border border-white/5 shadow-sm hover:border-orange-500/30 transition-all">
                <div className="flex items-center gap-2 text-orange-400 mb-3">
                  <Shield className="w-4 h-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Chống Replay Attack</h4>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                  Sử dụng Timestamp và Nonce trong mỗi thông điệp để ngăn chặn kẻ tấn công ghi lại các gói tin hợp lệ cũ và gửi lại nhằm gây nhiễu hệ thống.
                </p>
              </div>

              <div className="bg-white/5 p-5 rounded-2xl border border-white/5 shadow-sm hover:border-red-500/30 transition-all">
                <div className="flex items-center gap-2 text-red-400 mb-3">
                  <Database className="w-4 h-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Tính Bất biến</h4>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed font-medium">
                  Dữ liệu sau khi được đồng thuận sẽ được băm (Hash) và liên kết thành chuỗi. Việc sửa đổi dữ liệu quá khứ là bất khả thi về mặt toán học.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Traffic Flow Statistics Section */}
      <section className="max-w-7xl mx-auto px-6 mb-12">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 relative overflow-hidden shadow-xl shadow-black/20">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Activity className="w-32 h-32 text-blue-400" />
          </div>
          
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <BarChart className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Thống kê Lưu lượng Phương tiện</h2>
                  <p className="text-xs text-slate-500 font-bold">Giám sát các nút giao thông trọng điểm theo thời gian thực</p>
                </div>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Tổng lưu lượng (phương tiện/giờ)</p>
                  <p className="text-xl font-mono font-bold text-white">
                    {intersectionData.reduce((acc, curr) => acc + curr.flow, 0).toLocaleString()}
                  </p>
                </div>
                <div className="w-px h-8 bg-white/10" />
                <div className="text-center">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">Trạng thái hệ thống</p>
                  <div className="flex items-center gap-1.5 justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-sm font-bold text-emerald-400">ỔN ĐỊNH</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 h-[300px] bg-black/20 rounded-2xl border border-white/5 p-4 shadow-inner">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={intersectionData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d2d30" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10 }}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1a1a1e', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}
                      itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '10px' }}
                    />
                    <Bar dataKey="flow" radius={[4, 4, 0, 0]}>
                      {intersectionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.flow > 800 ? '#ef4444' : entry.flow > 500 ? '#f59e0b' : '#3b82f6'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Danh sách Chi tiết Nút giao</h3>
                {intersectionData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        item.flow > 800 ? "bg-red-500" : item.flow > 500 ? "bg-amber-500" : "bg-blue-500"
                      )} />
                      <span className="text-xs font-bold text-slate-200">{item.name}</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-xs font-mono font-bold text-white">{item.flow}</span>
                      <span className={cn(
                        "text-[9px] font-bold px-1.5 rounded uppercase",
                        item.flow > 800 ? "text-red-400 bg-red-400/10" : item.flow > 500 ? "text-amber-400 bg-amber-400/10" : "text-blue-400 bg-blue-400/10"
                      )}>
                        {item.flow > 800 ? "Ùn ứ" : item.flow > 500 ? "Đông" : "Thoáng"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Surveillance & Signal Distribution Section */}
      <section className="max-w-7xl mx-auto px-6 mb-12">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 relative overflow-hidden shadow-xl shadow-black/20">
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Camera className="w-32 h-32 text-violet-400" />
          </div>
          
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 text-technical">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <Camera className="w-5 h-5 text-violet-400" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">Vị trí Camera & Điều phối Tín hiệu</h2>
                  <p className="text-xs text-slate-500 font-mono italic font-bold tracking-widest uppercase">Surveillance Network & Signal Distribution System</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 bg-white/5 p-2 rounded-xl border border-white/10 shadow-inner">
                <div className="flex items-center gap-2 px-3 py-1 bg-violet-500/10 border border-violet-500/20 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                  <span className="text-[10px] font-bold text-violet-400 uppercase tracking-widest leading-none">CCTV ACTIVE</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest leading-none">SIGNALS SYNCED</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {intersectionData.map((item, idx) => (
                <div key={idx} className="bg-black/20 border border-white/5 rounded-2xl p-5 hover:border-violet-500/30 transition-all group">
                  <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                       <MapPin className="w-3 h-3 text-violet-400" />
                       <span className="text-[11px] font-bold text-white uppercase tracking-wider">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 border border-white/5 bg-white/5 px-2 py-0.5 rounded-full">
                       <Camera className="w-2.5 h-2.5 text-slate-500" />
                       <span className="text-[9px] font-bold text-slate-500">{item.cameras}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-5">
                    {/* Traffic Light Visual */}
                    <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex flex-col items-center justify-center relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-12 h-12 bg-blue-500 rounded-full -translate-y-1/2 translate-x-1/2 blur-xl opacity-5" />
                      <div className="space-y-1.5 mb-2">
                        <div className={cn("w-3 h-3 rounded-full transition-all duration-300", item.light === 'red' ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)] scale-110" : "bg-red-900/30")} />
                        <div className={cn("w-3 h-3 rounded-full transition-all duration-300", item.light === 'yellow' ? "bg-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.5)] scale-110" : "bg-amber-900/30")} />
                        <div className={cn("w-3 h-3 rounded-full transition-all duration-300", item.light === 'green' ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] scale-110" : "bg-emerald-900/30")} />
                      </div>
                      <div className="text-center">
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">Remaining</span>
                        <p className={cn(
                          "text-lg font-mono font-bold leading-none",
                          item.light === 'red' ? "text-red-400" : item.light === 'yellow' ? "text-amber-400" : "text-emerald-400"
                        )}>{item.timer}s</p>
                      </div>
                    </div>

                    {/* Camera Feed Status */}
                    <div className="bg-white/5 rounded-xl p-3 border border-white/5 flex flex-col items-center justify-center">
                      <div className="relative mb-2">
                        <div className="w-8 h-8 rounded-full bg-violet-500/10 flex items-center justify-center">
                          <Search className="w-4 h-4 text-violet-400" />
                        </div>
                        <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500 border-2 border-[#1a1a1e]" />
                      </div>
                      <div className="text-center">
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tighter">AI Monitoring</span>
                        <p className="text-[10px] font-bold text-emerald-400">NORMAL</p>
                        <span className="text-[7px] text-slate-500 font-mono">0.2ms Delay</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 font-bold">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500 font-medium italic">Current Flow</span>
                      <span className="text-white font-mono bg-white/5 px-1.5 rounded">{item.flow} v/h</span>
                    </div>
                    <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        initial={false}
                        animate={{ width: `${(item.flow / item.capacity) * 100}%` }}
                        className={cn(
                          "h-full transition-all duration-1000 shadow-blue-500/10",
                          item.flow > 800 ? "bg-red-500" : item.flow > 500 ? "bg-amber-500" : "bg-blue-500"
                        )}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Resilience & Fail-safe Explanation */}
      <div className="max-w-7xl mx-auto px-6 mb-24">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 shadow-xl shadow-black/20">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-orange-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Cơ chế Chống Sập & Khắc phục (Resilience)</h2>
              <p className="text-sm text-slate-500 font-bold">Làm thế hệ thống vẫn hoạt động khi bị tấn công hoặc lỗi mạng</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 font-bold border border-white/5 shadow-lg">01</div>
              <h3 className="text-lg font-bold text-slate-200 tracking-tight">Tính Dư thừa (Redundancy)</h3>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">
                Mạng lưới sử dụng 5 trạm RSU độc lập. Theo thuật toán PBFT, hệ thống vẫn hoạt động chính xác và duy trì đồng thuận ngay cả khi có 1-2 nút bị lỗi hoặc bị tấn công (nút độc hại).
              </p>
            </div>

            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 font-bold border border-white/5 shadow-lg">02</div>
              <h3 className="text-lg font-bold text-slate-200 tracking-tight">Chế độ Fail-safe (Nội bộ)</h3>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">
                Khi mạng V2X bị nhiễu hoặc sập, vi xử lý trên xe tự động chuyển sang chế độ <strong className="text-emerald-400">Local Priority</strong>. Các cảm biến MPU6050 vẫn kích hoạt phanh khẩn cấp dựa trên dữ liệu nội bộ mà không cần chờ mạng.
              </p>
            </div>

            <div className="space-y-4">
              <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-400 font-bold border border-white/5 shadow-lg">03</div>
              <h3 className="text-lg font-bold text-slate-200 tracking-tight">Cô lập & Tự phục hồi</h3>
              <p className="text-sm text-slate-400 leading-relaxed font-medium">
                Hệ thống IDS liên tục quét các nút. Khi phát hiện nút bị tấn công, hệ thống sẽ <strong className="text-violet-400">Cô lập (Isolate)</strong> nút đó ra khỏi mạng để tránh lây lan, trong khi các nút khác vẫn duy trì sổ cái.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer / Explanation */}
      <footer className="max-w-7xl mx-auto px-6 pb-12">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-8 shadow-xl shadow-black/20">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-emerald-400" />
            Kiến trúc Hệ thống Đề xuất (NCKH)
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase tracking-widest">
                <span className="w-6 h-6 rounded bg-emerald-500/10 aspect-square border border-emerald-500/20 flex items-center justify-center text-xs">1</span>
                Thu thập & Xử lý
              </div>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                <strong className="text-slate-200">MPU6050</strong> đo gia tốc 3 trục để phát hiện va chạm. 
                <strong className="text-slate-200"> Holybro M10N</strong> cung cấp tọa độ và phương chiều di chuyển. 
                Vi xử lý (ESP32/Arduino) tính toán ngưỡng G-force để kích hoạt cảnh báo.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm uppercase tracking-widest">
                <span className="w-6 h-6 rounded bg-blue-500/10 aspect-square border border-blue-500/20 flex items-center justify-center text-xs">2</span>
                Truyền tin V2X-DSRC
              </div>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Sử dụng công nghệ <strong className="text-slate-200">DSRC (WAVE)</strong> băng tần 5.9GHz để trao đổi dữ liệu an toàn giữa các phương tiện (V2V) với độ trễ cực thấp (&lt;10ms), cho phép cảnh báo tức thời.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-violet-400 font-bold text-sm uppercase tracking-widest">
                <span className="w-6 h-6 rounded bg-violet-500/10 aspect-square border border-violet-500/20 flex items-center justify-center text-xs">3</span>
                Bảo mật Blockchain
              </div>
              <p className="text-xs text-slate-400 leading-relaxed font-medium">
                Mọi thông điệp quan trọng được băm (Hash) và ghi vào <strong className="text-slate-200">Blockchain</strong>. Điều này đảm bảo dữ liệu va chạm không thể bị chỉnh sửa, phục vụ việc tra cứu trách nhiệm và bảo hiểm minh bạch.
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Scenario History / Snapshots */}
      <section className="max-w-7xl mx-auto px-6 pb-20">
        <div className="bg-[#1a1a1e] border border-white/5 rounded-3xl p-8 shadow-xl shadow-black/20">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <History className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Báo cáo Kết quả Thử nghiệm</h2>
                <p className="text-xs text-slate-500 font-bold">Dữ liệu được "chụp" lại sau mỗi lần chạy kịch bản</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {scenarioHistory.length > 0 && (
                <button 
                  onClick={handleExportExcel}
                  className="flex items-center gap-2 text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-black px-3 py-1.5 rounded-lg border border-emerald-500/30 transition-all font-bold uppercase tracking-widest"
                >
                  <Download className="w-3 h-3" />
                  Xuất Excel
                </button>
              )}
              <button 
                onClick={() => setScenarioHistory([])}
                className="text-[10px] text-slate-500 hover:text-red-500 transition-colors uppercase font-bold tracking-widest"
              >
                Xóa lịch sử
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {scenarioHistory.map((report, idx) => (
                <motion.div 
                  key={`${report.id}-${idx}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-black/20 border border-white/5 rounded-2xl overflow-hidden group hover:border-blue-500/30 transition-all shadow-xl"
                >
                  <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                    <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Kịch bản {report.scenarioId}</span>
                    <span className="text-[10px] text-slate-500 font-mono">{report.timestamp}</span>
                  </div>
                  <div className="p-5 space-y-4">
                    <h4 className="text-sm font-bold text-slate-200">{report.name}</h4>
                    <div className="space-y-2">
                      {Object.entries(report.data).map(([key, value]: [string, any]) => (
                        <div key={key} className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500 capitalize font-medium">{key}:</span>
                          <span className="text-slate-300 font-mono bg-white/5 px-1.5 rounded">{value}</span>
                        </div>
                      ))}
                    </div>
                    <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] text-emerald-400 font-bold tracking-tight">VERIFIED</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Database className="w-3 h-3 text-slate-600" />
                        <span className="text-[9px] text-slate-600 font-mono tracking-tighter">ID: {report.id.toString().slice(-6)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {scenarioHistory.length === 0 && (
              <div className="col-span-full py-20 border-2 border-dashed border-white/5 rounded-3xl flex flex-col items-center justify-center text-slate-600">
                <Terminal className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm italic">Chưa có báo cáo nào. Hãy nhấn "Chạy kịch bản" để ghi lại dữ liệu.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function StatCard({ icon, label, value, subValue, color }: { 
  icon: React.ReactNode, 
  label: string, 
  value: string, 
  subValue: string,
  color: 'emerald' | 'blue' | 'violet' | 'amber' | 'red'
}) {
  const colors = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    red: "text-red-400 bg-red-500/10 border-red-500/20",
  };

  return (
    <div className="bg-[#1a1a1e] border border-white/5 rounded-2xl p-4 hover:border-white/10 shadow-xl shadow-black/20 transition-all group">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center border", colors[color])}>
          {icon}
        </div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
      </div>
      <div className="space-y-1">
        <p className="text-xl font-bold text-white tracking-tight">{value}</p>
        <p className="text-[10px] text-slate-400 font-medium">{subValue}</p>
      </div>
    </div>
  );
}
