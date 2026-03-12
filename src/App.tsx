/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Camera, 
  Upload, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  History, 
  ShieldAlert,
  ChevronRight,
  Info,
  Filter,
  BarChart3,
  Map as MapIcon,
  ThumbsUp,
  AlertCircle,
  Sparkles,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeRoadImage, RoadHazardAnalysis } from './services/gemini';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  Timestamp, 
  updateDoc, 
  doc, 
  increment 
} from 'firebase/firestore';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import _ from 'lodash';

// Fix Leaflet icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Report {
  id: string;
  description: string;
  latitude: number;
  longitude: number;
  hazard_type: string;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  ai_analysis: string;
  timestamp: any;
  upvotes: number;
}

// Custom Marker Icon based on severity
const getMarkerIcon = (severity: string) => {
  const color = severity === 'high' ? '#ef4444' : severity === 'medium' ? '#f59e0b' : '#10b981';
  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: ${color}; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 5px rgba(0,0,0,0.3);"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });
};

export default function App() {
  const [view, setView] = useState<'report' | 'map' | 'dashboard'>('report');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analysis, setAnalysis] = useState<RoadHazardAnalysis | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [nearbyAlert, setNearbyAlert] = useState<Report | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch reports
  useEffect(() => {
    try {
      const q = query(collection(db, 'reports'), orderBy('timestamp', 'desc'));
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const reportsData: Report[] = [];
        querySnapshot.forEach((doc) => {
          reportsData.push({ id: doc.id, ...doc.data() } as Report);
        });
        setReports(reportsData);
      }, (err) => {
        console.error("Firestore error:", err);
        setError("Could not connect to database. Please check your Firebase configuration.");
      });
      return () => unsubscribe();
    } catch (e) {
      console.error("Setup error:", e);
      setError("Firebase not initialized. Check your environment variables.");
    }
  }, []);

  // Get user location & check for nearby hazards
  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const userLat = position.coords.latitude;
          const userLng = position.coords.longitude;
          setLocation({ lat: userLat, lng: userLng });

          // Check for nearby high severity hazards (within ~200 meters)
          const nearby = reports.find(r => {
            if (r.severity !== 'high') return false;
            const dist = Math.sqrt(
              Math.pow(r.latitude - userLat, 2) + 
              Math.pow(r.longitude - userLng, 2)
            );
            return dist < 0.002; // Roughly 200m
          });
          setNearbyAlert(nearby || null);
        },
        (err) => console.warn("Location access denied:", err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      const typeMatch = filterType === 'all' || r.hazard_type === filterType;
      const severityMatch = filterSeverity === 'all' || r.severity === filterSeverity;
      return typeMatch && severityMatch;
    });
  }, [reports, filterType, filterSeverity]);

  const stats = useMemo(() => {
    const total = reports.length;
    const highSeverity = reports.filter(r => r.severity === 'high').length;
    const typeCounts = _.countBy(reports, 'hazard_type');
    const mostCommon = _.maxBy(Object.keys(typeCounts), t => typeCounts[t]) || 'N/A';
    
    const chartData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }));
    const severityData = [
      { name: 'Low', value: reports.filter(r => r.severity === 'low').length, color: '#10b981' },
      { name: 'Medium', value: reports.filter(r => r.severity === 'medium').length, color: '#f59e0b' },
      { name: 'High', value: reports.filter(r => r.severity === 'high').length, color: '#ef4444' },
    ];

    return { total, highSeverity, mostCommon, chartData, severityData };
  }, [reports]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setSelectedImage(reader.result as string);
      setAnalysis(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    if (!selectedImage) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeRoadImage(selectedImage);
      setAnalysis(result);
    } catch (err: any) {
      setError(err.message || "Failed to analyze image.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveReport = async () => {
    if (!analysis || !selectedImage) return;
    setIsSaving(true);
    try {
      const reportData = {
        description: analysis.explanation,
        latitude: location?.lat || 0,
        longitude: location?.lng || 0,
        hazard_type: analysis.hazard_type,
        severity: analysis.severity,
        confidence: analysis.confidence,
        ai_analysis: analysis.explanation,
        timestamp: Timestamp.now(),
        upvotes: 0
      };
      await addDoc(collection(db, 'reports'), reportData);
      setSelectedImage(null);
      setAnalysis(null);
      setView('map');
    } catch (err: any) {
      setError("Failed to save report: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpvote = async (reportId: string) => {
    try {
      const reportRef = doc(db, 'reports', reportId);
      await updateDoc(reportRef, { upvotes: increment(1) });
    } catch (err) {
      console.error("Upvote failed:", err);
    }
  };

  const generateAiSummary = async () => {
    if (reports.length === 0) return;
    setIsGeneratingSummary(true);
    try {
      const reportContext = reports.slice(0, 10).map(r => 
        `- ${r.hazard_type} (${r.severity} severity) at ${r.latitude}, ${r.longitude}: ${r.description}`
      ).join('\n');

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Based on these recent road hazard reports, provide a concise 2-3 sentence summary of the overall road conditions and safety advice for drivers in this area:\n\n${reportContext}`
      });
      setAiSummary(response.text);
    } catch (err) {
      console.error("Summary generation failed:", err);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Navigation Rail */}
      <nav className="fixed left-0 top-0 bottom-0 w-20 bg-white border-r border-black/5 flex flex-col items-center py-8 gap-8 z-[1000]">
        <div className="bg-emerald-600 p-3 rounded-2xl text-white shadow-lg shadow-emerald-200">
          <ShieldAlert size={24} />
        </div>
        <div className="flex flex-col gap-4">
          <NavButton active={view === 'report'} onClick={() => setView('report')} icon={<Camera size={20} />} label="Report" />
          <NavButton active={view === 'map'} onClick={() => setView('map')} icon={<MapIcon size={20} />} label="Map" />
          <NavButton active={view === 'dashboard'} onClick={() => setView('dashboard')} icon={<BarChart3 size={20} />} label="Stats" />
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="pl-20 min-h-screen">
        {/* Header */}
        <header className="bg-white border-b border-black/5 px-8 py-6 flex items-center justify-between sticky top-0 z-50 backdrop-blur-md bg-white/80">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RoadGuard AI</h1>
            <p className="text-sm text-gray-500 font-medium">Real-time Road Infrastructure Monitoring</p>
          </div>
          <div className="flex items-center gap-6">
            {location && (
              <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-4 py-2 rounded-full border border-black/5">
                <MapPin size={14} className="text-emerald-600" />
                {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
              </div>
            )}
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          {/* Nearby Alert */}
          <AnimatePresence>
            {nearbyAlert && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-8 bg-red-600 text-white p-4 rounded-2xl shadow-xl flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle className="animate-pulse" />
                  <div>
                    <p className="font-bold">High Severity Hazard Nearby!</p>
                    <p className="text-sm opacity-90">A {nearbyAlert.hazard_type} was reported very close to your current location.</p>
                  </div>
                </div>
                <button onClick={() => setNearbyAlert(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {view === 'report' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 space-y-8">
                <section className="bg-white rounded-[2rem] shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-8 border-b border-black/5 flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600">
                        <Upload size={20} />
                      </div>
                      Submit New Report
                    </h2>
                  </div>
                  <div className="p-8">
                    {!selectedImage ? (
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-video border-2 border-dashed border-gray-100 rounded-[2rem] flex flex-col items-center justify-center gap-6 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-all group"
                      >
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Camera size={32} className="text-gray-300 group-hover:text-emerald-600" />
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">Drop road image here</p>
                          <p className="text-sm text-gray-400 font-medium">Click to browse files (JPG, PNG)</p>
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" className="hidden" />
                      </div>
                    ) : (
                      <div className="space-y-8">
                        <div className="relative aspect-video rounded-[2rem] overflow-hidden bg-gray-100 shadow-inner">
                          <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          {!analysis && !isAnalyzing && (
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm">
                              <button onClick={handleAnalyze} className="bg-white text-black px-8 py-4 rounded-2xl font-bold shadow-2xl hover:scale-105 transition-transform flex items-center gap-3">
                                <Sparkles size={20} className="text-emerald-600" />
                                Start AI Analysis
                              </button>
                            </div>
                          )}
                          <button onClick={() => setSelectedImage(null)} className="absolute top-6 right-6 bg-white/20 backdrop-blur-md p-2 rounded-full text-white hover:bg-white/40 transition-colors">
                            <X size={20} />
                          </button>
                        </div>

                        {isAnalyzing && (
                          <div className="bg-emerald-50 border border-emerald-100 rounded-3xl p-8 flex items-center gap-6">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm">
                              <Loader2 className="animate-spin text-emerald-600" />
                            </div>
                            <div>
                              <p className="font-bold text-emerald-900">Gemini Vision is analyzing...</p>
                              <p className="text-sm text-emerald-700 font-medium">Detecting potholes, cracks, and road damage.</p>
                            </div>
                          </div>
                        )}

                        {analysis && (
                          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                            <div className="grid grid-cols-3 gap-4">
                              <StatBox label="Hazard Type" value={analysis.hazard_type} />
                              <StatBox label="Severity" value={analysis.severity} highlight={analysis.severity} />
                              <StatBox label="AI Confidence" value={`${analysis.confidence}%`} />
                            </div>
                            <div className="bg-gray-50 p-8 rounded-3xl border border-black/5">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">AI Explanation</p>
                              <p className="text-gray-700 leading-relaxed font-medium">{analysis.explanation}</p>
                            </div>
                            <button 
                              onClick={handleSaveReport} 
                              disabled={isSaving}
                              className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 flex items-center justify-center gap-3 disabled:opacity-50"
                            >
                              {isSaving ? <Loader2 className="animate-spin" /> : <CheckCircle2 size={20} />}
                              {isSaving ? 'Saving to Database...' : 'Confirm & Publish Report'}
                            </button>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="lg:col-span-5 space-y-8">
                <section className="bg-white rounded-[2rem] shadow-sm border border-black/5 overflow-hidden">
                  <div className="p-8 border-b border-black/5 flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
                        <History size={20} />
                      </div>
                      Recent Activity
                    </h2>
                  </div>
                  <div className="divide-y divide-black/5 max-h-[600px] overflow-y-auto">
                    {reports.slice(0, 5).map(report => (
                      <div key={report.id} className="p-6 hover:bg-gray-50 transition-colors group">
                        <div className="flex items-center justify-between mb-3">
                          <SeverityBadge severity={report.severity} />
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                            {report.timestamp?.toDate?.().toLocaleDateString()}
                          </span>
                        </div>
                        <h3 className="font-bold text-lg mb-1 group-hover:text-emerald-600 transition-colors capitalize">{report.hazard_type}</h3>
                        <p className="text-sm text-gray-500 font-medium line-clamp-2 mb-4">{report.description}</p>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <button onClick={() => handleUpvote(report.id)} className="flex items-center gap-2 text-xs font-bold text-gray-400 hover:text-emerald-600 transition-colors">
                              <ThumbsUp size={14} />
                              {report.upvotes}
                            </button>
                            <span className="flex items-center gap-1 text-[10px] font-bold text-gray-300 uppercase">
                              <MapPin size={12} />
                              {report.latitude.toFixed(2)}, {report.longitude.toFixed(2)}
                            </span>
                          </div>
                          <ChevronRight size={18} className="text-gray-200 group-hover:text-emerald-400 transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}

          {view === 'map' && (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <FilterDropdown label="Type" value={filterType} onChange={setFilterType} options={['all', 'pothole', 'crack', 'waterlogging', 'obstacle', 'debris', 'damaged road']} />
                  <FilterDropdown label="Severity" value={filterSeverity} onChange={setFilterSeverity} options={['all', 'low', 'medium', 'high']} />
                  <button 
                    onClick={() => setShowHeatmap(!showHeatmap)}
                    className={cn(
                      "px-4 py-2 rounded-2xl font-bold text-xs border transition-all shadow-sm",
                      showHeatmap ? "bg-orange-500 text-white border-orange-600" : "bg-white text-gray-600 border-black/5"
                    )}
                  >
                    Heatmap: {showHeatmap ? 'ON' : 'OFF'}
                  </button>
                </div>
                <button 
                  onClick={generateAiSummary} 
                  disabled={isGeneratingSummary}
                  className="bg-white border border-black/5 px-6 py-3 rounded-2xl font-bold text-sm flex items-center gap-3 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
                >
                  {isGeneratingSummary ? <Loader2 className="animate-spin text-emerald-600" /> : <Sparkles size={18} className="text-emerald-600" />}
                  AI Area Summary
                </button>
              </div>

              {aiSummary && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-600 text-white p-8 rounded-[2rem] shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                  <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-4">
                      <Sparkles size={20} />
                      <h3 className="font-bold uppercase tracking-widest text-xs opacity-80">Smart AI Summary</h3>
                    </div>
                    <p className="text-xl font-medium leading-relaxed italic">"{aiSummary}"</p>
                    <button onClick={() => setAiSummary(null)} className="absolute top-0 right-0 p-2 opacity-60 hover:opacity-100">
                      <X size={20} />
                    </button>
                  </div>
                </motion.div>
              )}

              <div className="h-[700px] rounded-[2.5rem] overflow-hidden border border-black/5 shadow-2xl relative">
                <MapContainer center={location || [0, 0]} zoom={location ? 15 : 2} className="h-full w-full z-10">
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                  {showHeatmap && <HeatmapLayer reports={filteredReports} />}
                  {filteredReports.map(report => (
                    <Marker key={report.id} position={[report.latitude, report.longitude]} icon={getMarkerIcon(report.severity)}>
                      <Popup className="custom-popup">
                        <div className="p-2 min-w-[200px]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">{report.hazard_type}</span>
                            <SeverityBadge severity={report.severity} />
                          </div>
                          <p className="text-sm font-bold mb-1">{report.description}</p>
                          <p className="text-xs text-gray-500 mb-3 italic">"{report.ai_analysis}"</p>
                          <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                            <span className="text-[10px] text-gray-400 font-bold">{report.timestamp?.toDate?.().toLocaleDateString()}</span>
                            <div className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
                              <ThumbsUp size={10} /> {report.upvotes}
                            </div>
                          </div>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                  <MapUpdater center={location} />
                </MapContainer>
                
                {/* Map Legend */}
                <div className="absolute bottom-8 left-8 bg-white/90 backdrop-blur-md p-4 rounded-2xl border border-black/5 z-[1000] shadow-xl">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Severity Legend</p>
                  <div className="flex flex-col gap-2">
                    <LegendItem color="#ef4444" label="High Hazard" />
                    <LegendItem color="#f59e0b" label="Medium Hazard" />
                    <LegendItem color="#10b981" label="Low Hazard" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {view === 'dashboard' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <DashboardCard label="Total Hazards" value={stats.total} icon={<AlertCircle size={24} />} color="emerald" />
                <DashboardCard label="High Severity" value={stats.highSeverity} icon={<AlertTriangle size={24} />} color="red" />
                <DashboardCard label="Most Common" value={stats.mostCommon} icon={<Info size={24} />} color="amber" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <section className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm">
                  <h3 className="text-lg font-bold mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600">
                      <BarChart3 size={18} />
                    </div>
                    Hazard Distribution
                  </h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.chartData}>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
                        <RechartsTooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                        <Bar dataKey="value" fill="#10b981" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="bg-white rounded-[2rem] p-8 border border-black/5 shadow-sm">
                  <h3 className="text-lg font-bold mb-8 flex items-center gap-3">
                    <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600">
                      <AlertTriangle size={18} />
                    </div>
                    Severity Breakdown
                  </h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={stats.severityData} innerRadius={60} outerRadius={100} paddingAngle={8} dataKey="value">
                          {stats.severityData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-8 mt-4">
                    {stats.severityData.map(s => (
                      <div key={s.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Sub-components
function NavButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-2 p-3 rounded-2xl transition-all group relative",
        active ? "text-emerald-600 bg-emerald-50" : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
      )}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-tighter">{label}</span>
      {active && <motion.div layoutId="nav-active" className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-emerald-600 rounded-r-full" />}
    </button>
  );
}

function StatBox({ label, value, highlight }: { label: string, value: string | number, highlight?: string }) {
  return (
    <div className="bg-gray-50 p-4 rounded-2xl border border-black/5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className={cn(
        "font-bold text-lg capitalize",
        highlight === 'high' ? "text-red-600" : highlight === 'medium' ? "text-amber-600" : highlight === 'low' ? "text-emerald-600" : "text-black"
      )}>{value}</p>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-emerald-100 text-emerald-700"
  };
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full", colors[severity as keyof typeof colors])}>
      {severity}
    </span>
  );
}

function DashboardCard({ label, value, icon, color }: { label: string, value: string | number, icon: React.ReactNode, color: 'emerald' | 'red' | 'amber' }) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    red: "bg-red-50 text-red-600 border-red-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100"
  };
  return (
    <div className={cn("p-8 rounded-[2rem] border shadow-sm", colors[color])}>
      <div className="flex items-center justify-between mb-4">
        <div className="p-3 bg-white rounded-xl shadow-sm">{icon}</div>
        <p className="text-4xl font-black tracking-tighter">{value}</p>
      </div>
      <p className="text-xs font-bold uppercase tracking-widest opacity-60">{label}</p>
    </div>
  );
}

function FilterDropdown({ label, value, onChange, options }: { label: string, value: string, onChange: (v: string) => void, options: string[] }) {
  return (
    <div className="flex items-center gap-3 bg-white border border-black/5 px-4 py-2 rounded-2xl shadow-sm">
      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)}
        className="text-sm font-bold bg-transparent border-none focus:ring-0 cursor-pointer capitalize"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </div>
  );
}

function LegendItem({ color, label }: { color: string, label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">{label}</span>
    </div>
  );
}

function HeatmapLayer({ reports }: { reports: Report[] }) {
  const map = useMap();
  useEffect(() => {
    if (!reports.length) return;
    const points: [number, number, number][] = reports.map(r => [
      r.latitude, 
      r.longitude, 
      r.severity === 'high' ? 1.0 : r.severity === 'medium' ? 0.6 : 0.3
    ]);
    // @ts-ignore
    const heat = L.heatLayer(points, { radius: 25, blur: 15, maxZoom: 17 }).addTo(map);
    return () => {
      map.removeLayer(heat);
    };
  }, [reports, map]);
  return null;
}

function MapUpdater({ center }: { center: { lat: number, lng: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView([center.lat, center.lng], map.getZoom());
    }
  }, [center, map]);
  return null;
}
