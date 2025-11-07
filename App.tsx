

import React, { useState, useCallback, useMemo, useRef, useEffect, Dispatch, SetStateAction } from 'react';
// FIX: Renamed `Tooltip` to `RechartsTooltip` to avoid a naming conflict with the custom Tooltip component defined below.
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { useLocalStorage } from './hooks/useLocalStorage';
import { Screen, DictationLevel, Word, Dictation, HistoryEntry, SessionType, ListeningExercise, Question, QuizExercise, QuizQuestion, NewsListeningExercise } from './types';
import { 
    generateDictationText, generateAudio, generateImageForText, generatePersonalizedFeedback, generateStatisticsReport,
    generateListeningExercise, generateVocabularyQuiz, generateNewsListeningExercise, generateTranslation
} from './services/geminiService';
import { getCache, setCache } from './services/cacheService';

// --- Theme Hook ---
const useTheme = (): [string, () => void] => {
  const [theme, setTheme] = useLocalStorage<'light' | 'dark'>('theme', 'light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove(theme === 'dark' ? 'light' : 'dark');
    root.classList.add(theme);
    // Add a 'ready' class to the body after the first theme setup to trigger animations
    document.body.classList.add('ready');
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  return [theme, toggleTheme];
};


// --- Audio Processing Helpers ---
// Decode base64 to Uint8Array
function decode(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Write string to DataView for WAV header
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// Encode raw PCM data (as Int16Array) to a WAV Blob
function encodeWAV(samples: Int16Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
        view.setInt16(44 + i * 2, samples[i], true);
    }
    return new Blob([view], { type: 'audio/wav' });
}


const DICTATION_LEVELS: Record<DictationLevel, { count: number; description: string }> = {
  [DictationLevel.Basic]: { count: 8, description: 'B2 Level' },
  [DictationLevel.Intermediate]: { count: 15, description: 'C1 Level' },
  [DictationLevel.Advanced]: { count: 20, description: 'C2 Level' },
  [DictationLevel.Strategic]: { count: 22, description: 'C1–C2+ Executive Fluency' },
};


const AVAILABLE_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

// --- Icons ---
const PlayIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.647c1.295.742 1.295 2.545 0 3.286L7.279 20.99c-1.25.717-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" /></svg>;
const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M6.75 5.25a.75.75 0 00-.75.75v12a.75.75 0 00.75.75h.75a.75.75 0 00.75-.75V6a.75.75 0 00-.75-.75H6.75zm8.25 0a.75.75 0 00-.75.75v12a.75.75 0 00.75.75h.75a.75.75 0 00.75-.75V6a.75.75 0 00-.75-.75h-.75z" clipRule="evenodd" /></svg>;
const SpeakerIcon = ({ className = "w-5 h-5" }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.944.945 2.56.276 2.56-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" /><path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" /></svg>;
const AmbientSoundOnIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.66 1.905H6.44l4.5 4.5c.944.945 2.56.276 2.56-1.06V4.06zM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 1 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06z" /><path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06z" /></svg>;
const AmbientSoundOffIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M9.563 3.004a.75.75 0 0 1 .68.043l4.5 4.5H18a.75.75 0 0 1 0 1.5h-3.252l5.034 5.034a.75.75 0 0 1-1.06 1.06l-2.68-2.68a.75.75 0 0 1 .53-1.28H18a.75.75 0 0 1 0-1.5h-1.393l-4.11-4.111v6.284a.75.75 0 0 1-1.5 0V8.221L6.97 4.192a.75.75 0 0 1 1.06-1.06L9.564 4.66v-1.59a.75.75 0 0 1 .001-.068ZM5.47 5.47a.75.75 0 1 0-1.06 1.06L9.564 11.68v6.256a.75.75 0 0 0 1.5 0v-2.348l3.153 3.153a.75.75 0 0 0 1.06-1.06L5.47 5.47Z" clipRule="evenodd" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478A48.567 48.567 0 0016.5 6.453v-1.975zM8.5 4.478v.227a48.817 48.817 0 00-3.878.512.75.75 0 11.256-1.478A48.567 48.567 0 018.5 6.453v-1.975zM16.125 18.75h.008v.008h-.008v-.008zM12 18.75h.008v.008H12v-.008zM7.875 18.75h.008v.008h-.008v-.008zM17.25 9.75a.75.75 0 00-1.5 0v6a.75.75 0 001.5 0v-6zM12.75 9.75a.75.75 0 00-1.5 0v6a.75.75 0 001.5 0v-6zM8.25 9.75a.75.75 0 00-1.5 0v6a.75.75 0 001.5 0v-6zM3.375 7.5a.75.75 0 00-1.5 0v11.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V7.5a.75.75 0 00-1.5 0v11.25a.375.375 0 01-.375.375H3.75a.375.375 0 01-.375-.375V7.5zM9 4.125a.75.75 0 01.75-.75h4.5a.75.75 0 01.75.75v.375c0 .621.504 1.125 1.125 1.125h2.25a.75.75 0 010 1.5h-2.25a2.625 2.625 0 00-2.625 2.625v.375a.75.75 0 01-1.5 0v-.375a1.125 1.125 0 011.125-1.125h2.25a.75.75 0 000-1.5H12a2.625 2.625 0 00-2.625 2.625v.375a.75.75 0 01-1.5 0v-.375a1.125 1.125 0 011.125-1.125h.375a.75.75 0 000-1.5h-.375A2.625 2.625 0 006 8.625v.375a.75.75 0 01-1.5 0v-.375a2.625 2.625 0 012.625-2.625h2.25c.621 0 1.125-.504 1.125-1.125V4.125z" clipRule="evenodd" /></svg>;
const RewindIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M9.53 2.47a.75.75 0 0 1 0 1.06L4.81 8.25H15a6.75 6.75 0 0 1 0 13.5h-3a.75.75 0 0 1 0-1.5h3a5.25 5.25 0 1 0 0-10.5H4.81l4.72 4.72a.75.75 0 1 1-1.06 1.06l-6-6a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>;
const ChevronDownIcon = ({ expanded }: { expanded: boolean }) => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M12.53 16.28a.75.75 0 0 1-1.06 0l-7.5-7.5a.75.75 0 0 1 1.06-1.06L12 14.69l6.97-6.97a.75.75 0 1 1 1.06 1.06l-7.5 7.5Z" clipRule="evenodd" /></svg>;
const SunIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.899 6.101a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5h2.25a.75.75 0 0 1 .75.75ZM17.899 17.899a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM6.101 17.899a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM3 12a.75.75 0 0 1-.75.75H.75a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 3 12ZM6.101 6.101a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 0 0-1.061 1.06l1.59 1.591Z" /></svg>;
const MoonIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.981A10.503 10.503 0 0 1 18 19.5a10.5 10.5 0 0 1-10.5-10.5A10.503 10.503 0 0 1 9.528 1.718Z" clipRule="evenodd" /></svg>;
const ChartBarIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path d="M18.375 2.25c-1.035 0-1.875.84-1.875 1.875v15.75c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V4.125c0-1.035-.84-1.875-1.875-1.875h-.75ZM9.75 8.625c-1.035 0-1.875.84-1.875 1.875v11.25c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V10.5c0-1.035-.84-1.875-1.875-1.875h-.75ZM3 13.5c-1.035 0-1.875.84-1.875 1.875v6.375c0 1.035.84 1.875 1.875 1.875h.75c1.035 0 1.875-.84 1.875-1.875V15.375c0-1.035-.84-1.875-1.875-1.875h-.75Z" /></svg>;
const UploadIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M11.25 4.53v11.59l-2.22-2.22a.75.75 0 00-1.06 1.06l3.5 3.5a.75.75 0 001.06 0l3.5-3.5a.75.75 0 10-1.06-1.06l-2.22 2.22V4.53a.75.75 0 00-1.5 0Z" /><path d="M19.5 15a.75.75 0 00-1.5 0v2.25a3 3 0 01-3 3H9a3 3 0 01-3-3V15a.75.75 0 00-1.5 0v2.25a4.5 4.5 0 004.5 4.5h6a4.5 4.5 0 004.5-4.5V15a.75.75 0 00-1.5 0Z" /></svg>;
const DownloadIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M12 2.25a.75.75 0 01.75.75v11.69l3.22-3.22a.75.75 0 111.06 1.06l-4.5 4.5a.75.75 0 01-1.06 0l-4.5-4.5a.75.75 0 111.06-1.06l3.22 3.22V3a.75.75 0 01.75-.75Zm-9 13.5a.75.75 0 01.75.75v2.25a1.5 1.5 0 001.5 1.5h10.5a1.5 1.5 0 001.5-1.5V16.5a.75.75 0 011.5 0v2.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V16.5a.75.75 0 01.75-.75Z" clipRule="evenodd" /></svg>;
const SearchIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><path fillRule="evenodd" d="M10.5 3.75a6.75 6.75 0 1 0 0 13.5 6.75 6.75 0 0 0 0-13.5ZM2.25 10.5a8.25 8.25 0 1 1 14.59 5.28l4.69 4.69a.75.75 0 1 1-1.06 1.06l-4.69-4.69A8.25 8.25 0 0 1 2.25 10.5Z" clipRule="evenodd" /></svg>;
const Spinner = ({ text, small }: { text?: string, small?: boolean }) => (
    <div className="flex flex-col items-center justify-center p-1">
      <svg className={`animate-spin ${small ? 'h-5 w-5' : 'h-8 w-8'} text-indigo-500`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      {text && <p className="mt-4 text-slate-600 dark:text-slate-300 animate-pulse">{text}</p>}
    </div>
);
const VoiceIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M7 3a.75.75 0 0 1 .75.75v1.25a.75.75 0 0 1-1.5 0V3.75A.75.75 0 0 1 7 3ZM9.5 5.035a.75.75 0 0 1 .75-.75h4a.75.75 0 0 1 .75.75v13.93a.75.75 0 0 1-.75-.75h-4a.75.75 0 0 1-.75-.75V5.035ZM17 5.75a.75.75 0 0 0-1.5 0v1.25a.75.75 0 0 0 1.5 0V5.75ZM3.25 7.5a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5ZM19.25 7.5a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5Z" /><path fillRule="evenodd" d="M4.75 11.25a.75.75 0 0 0-1.5 0v1.5a.75.75 0 0 0 1.5 0v-1.5ZM19.25 11.25a.75.75 0 0 1 1.5 0v1.5a.75.75 0 0 1-1.5 0v-1.5Z" clipRule="evenodd" /><path d="M7 14.75a.75.75 0 0 1 .75-.75h.008a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75h-.008a.75.75 0 0 1-.75-.75v-.008ZM15.5 15.5a.75.75 0 0 0 0-1.5h-.008a.75.75 0 0 0 0 1.5h.008Z" /><path fillRule="evenodd" d="M3.25 15a.75.75 0 0 0 0 1.5h1.5a.75.75 0 0 0 0-1.5h-1.5ZM19.25 15a.75.75 0 0 1 1.5 0v1.5a.75.75 0 0 1-1.5 0v-1.5Z" clipRule="evenodd" /><path d="M7 18.25a.75.75 0 0 1 .75.75v.008a.75.75 0 0 1-.75.75h-.008a.75.75 0 0 1-.75-.75v-.008a.75.75 0 0 1 .75-.75h.008Z" /></svg>;
const CheckIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${className ?? ''}`}><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.052-.143Z" clipRule="evenodd" /></svg>;
const XMarkIcon = ({ className }: { className?: string }) => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${className ?? ''}`}><path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" /></svg>;
const BrainIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mr-2"><path fillRule="evenodd" d="M6.75 3.333c2.237 0 4.253.93 5.673 2.452l.06.065.06-.065C13.934 4.263 15.95 3.333 18.188 3.333a5.417 5.417 0 0 1 3.5 9.61c-1.373 1.56-3.235 2.803-5.188 3.768V20.5a.75.75 0 0 1-1.5 0v-3.789a24.131 24.131 0 0 0-1.5 0V20.5a.75.75 0 0 1-1.5 0v-3.789c-1.953-.965-3.815-2.208-5.188-3.768a5.417 5.417 0 0 1 3.5-9.61Zm1.785 4.88a.75.75 0 0 0-1.07-1.06 3.917 3.917 0 0 0-2.68 7.394 3.896 3.896 0 0 0 .157.266c1.13 1.3 2.76 2.36 4.48 3.193V15.5a.75.75 0 0 1 1.5 0v2.446a21.149 21.149 0 0 1 1.5 0V15.5a.75.75 0 0 1 1.5 0v2.446c1.72-.833 3.35-1.893 4.48-3.193a3.896 3.896 0 0 0 .157-.266 3.917 3.917 0 0 0-2.68-7.394.75.75 0 0 0-1.07 1.06 2.417 2.417 0 0 1 1.61 4.545 2.37 2.37 0 0 1-.095.16c-.793.91-1.99 1.76-3.41 2.443V13.5a.75.75 0 0 0-1.5 0v3.348a18.23 18.23 0 0 0-1.5 0V13.5a.75.75 0 0 0-1.5 0v3.348c-1.42-.683-2.617-1.532-3.41-2.442a2.37 2.37 0 0 1-.095-.16 2.417 2.417 0 0 1 1.61-4.545Z" clipRule="evenodd" /></svg>;
const EarIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mr-2"><path d="M12.636 2.622a3.75 3.75 0 0 1 5.486 4.69l-1.06 1.836a.75.75 0 0 1-1.299-.75l1.06-1.836a2.25 2.25 0 0 0-3.291-2.814l-2.074 1.198a3.75 3.75 0 0 1-3.292 6.008v1.875a3.75 3.75 0 0 1-7.5 0v-1.833a.75.75 0 0 1 1.5 0V15a2.25 2.25 0 0 0 4.5 0v-1.875a5.25 5.25 0 0 0 4.609-8.506l2.074-1.198Z" /><path d="M15.75 9.75a2.25 2.25 0 0 1 2.25 2.25v.041a.75.75 0 0 1-1.5 0V12a.75.75 0 0 0-.75-.75h-.041a.75.75 0 0 1 0-1.5H15.75Z" /></svg>;
const QuizIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mr-2"><path fillRule="evenodd" d="M2.25 6a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5.25a3 3 0 0 1-3-3V6Zm3.97.97a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1 0 1.06l-2.25 2.25a.75.75 0 0 1-1.06-1.06L7.44 9 6.22 7.78a.75.75 0 0 1 0-1.06ZM11.25 9a.75.75 0 0 0 0 1.5h5.25a.75.75 0 0 0 0-1.5H11.25Z" clipRule="evenodd" /></svg>;
const NewspaperIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 mr-2"><path fillRule="evenodd" d="M4.125 3C3.089 3 2.25 3.84 2.25 4.875V18a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V4.875C23.25 3.839 22.41 3 21.375 3H4.125ZM12 8.25a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75ZM10.5 8.25a.75.75 0 0 0-1.5 0v3a.75.75 0 0 0 1.5 0v-3ZM15 8.25a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75ZM4.5 15.75a.75.75 0 0 0 0 1.5h15a.75.75 0 0 0 0-1.5H4.5Z" clipRule="evenodd" /><path d="M4.125 3H3V18a4.5 4.5 0 0 0 4.5 4.5h13.5a1.5 1.5 0 0 0 1.5-1.5V3H4.125Z" /></svg>;
const MenuIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M3 6.75A.75.75 0 0 1 3.75 6h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 6.75ZM3 12a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 12Zm0 5.25a.75.75 0 0 1 .75-.75h16.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z" clipRule="evenodd" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" /></svg>;



const SimpleMarkdownRenderer = ({ text }: { text: string }) => {
    const parts = text.split(/(\n- .+(?:\n- .+)*)/g).filter(Boolean);

    return (
        <div className="prose prose-sm dark:prose-invert max-w-none text-left">
            {parts.map((part, index) => {
                if (part.startsWith('\n- ')) {
                    const items = part.trim().split('\n').map(item => item.substring(2));
                    return (
                        <ul key={index} className="list-disc pl-5 space-y-1">
                            {items.map((item, i) => <li key={i}>{item}</li>)}
                        </ul>
                    );
                }
                const lines = part.trim().split('\n');
                return lines.map((line, i) => {
                     if (line.startsWith('### ')) return <h5 key={`${index}-${i}`} className="font-bold mt-3 mb-1 text-base">{line.substring(4)}</h5>
                     if (line.startsWith('## ')) return <h4 key={`${index}-${i}`} className="text-lg font-bold mt-4 mb-2">{line.substring(3)}</h4>
                     if (line.startsWith('# ')) return <h3 key={`${index}-${i}`} className="text-xl font-bold mt-4 mb-2">{line.substring(2)}</h3>
                     if (line.trim() === '') return null;
                     return <p key={`${index}-${i}`} className="my-2">{line}</p>
                });
            })}
        </div>
    );
};


// Main App Component
export default function App() {
  const [screen, setScreen] = useState<Screen>(Screen.PracticeHub);
  const [words, setWords] = useLocalStorage<Word[]>('dictation_words', []);
  const [history, setHistory] = useLocalStorage<HistoryEntry[]>('dictation_history', []);
  const [currentDictation, setCurrentDictation] = useState<Dictation | null>(null);
  const [currentListening, setCurrentListening] = useState<ListeningExercise | null>(null);
  const [currentNewsListening, setCurrentNewsListening] = useState<NewsListeningExercise | null>(null);
  const [currentQuiz, setCurrentQuiz] = useState<QuizExercise | null>(null);
  const [lastResult, setLastResult] = useState<HistoryEntry | null>(null);
  const [theme, toggleTheme] = useTheme();
  const [selectedVoice, setSelectedVoice] = useLocalStorage<string>('dictation_voice', 'Kore');
  const [isAmbientSoundOn, setIsAmbientSoundOn] = useLocalStorage('ambient_sound_on', false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const audioEl = document.getElementById('ambient-sound') as HTMLAudioElement;
    if (audioEl) {
        audioEl.volume = 0.1;
        if (isAmbientSoundOn) {
            audioEl.play().catch(e => console.log("Ambient audio playback failed", e));
        } else {
            audioEl.pause();
        }
    }
  }, [isAmbientSoundOn]);

  const navigateTo = (newScreen: Screen) => {
    setScreen(newScreen);
    setIsMobileMenuOpen(false); // Close mobile menu on navigation
  }

  const startDictation = (dictation: Dictation) => {
    setCurrentDictation(dictation);
    navigateTo(Screen.DictationPractice);
  };
  
  const startListening = (exercise: ListeningExercise) => {
    setCurrentListening(exercise);
    navigateTo(Screen.ListeningPractice);
  };
  
  const startNewsListening = (exercise: NewsListeningExercise) => {
      setCurrentNewsListening(exercise);
      navigateTo(Screen.NewsListeningPractice);
  };

  const startQuiz = (exercise: QuizExercise) => {
    setCurrentQuiz(exercise);
    navigateTo(Screen.VocabularyQuiz);
  };

  const finishSession = (result: HistoryEntry) => {
    setHistory(prevHistory => [result, ...prevHistory]);
    setLastResult(result);

    if (result.type === SessionType.Dictation) {
        setWords(prevWords => {
          const dictationWords = new Set((result.errors.map(e => e.word)).concat(result.errors.map(e => e.word.toLowerCase())));
          const errorWords = new Set(result.errors.map(e => e.word.toLowerCase()));
          const now = new Date().toISOString();
    
          return prevWords.map(word => {
            const lowerCaseText = word.text.toLowerCase();
            const wasUsed = dictationWords.has(lowerCaseText);
            const wasError = errorWords.has(lowerCaseText);
    
            if (!wasUsed) return word;
    
            return {
              ...word,
              usageCount: (word.usageCount || 0) + 1,
              lastUsed: now,
              errorCount: wasError ? (word.errorCount || 0) + 1 : (word.errorCount || 0),
            };
          });
        });
    }

    navigateTo(Screen.Results);
  };
  
  const renderScreen = () => {
    switch (screen) {
      case Screen.ManageWords:
        return <ManageWords words={words} setWords={setWords} navigateTo={navigateTo} />;
      case Screen.PracticeHub:
        return <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
      case Screen.DictationPractice:
        return currentDictation ? <DictationPractice dictation={currentDictation} onFinish={finishSession} selectedVoice={selectedVoice} /> : <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
      case Screen.ListeningPractice:
        return currentListening ? <ListeningPractice exercise={currentListening} onFinish={finishSession} selectedVoice={selectedVoice} /> : <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
      case Screen.NewsListeningPractice:
        return currentNewsListening ? <NewsListeningPractice exercise={currentNewsListening} onFinish={finishSession} selectedVoice={selectedVoice} /> : <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
      case Screen.VocabularyQuiz:
        return currentQuiz ? <VocabularyQuizPractice exercise={currentQuiz} onFinish={finishSession} /> : <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
      case Screen.Results:
        return lastResult ? <Results result={lastResult} words={words} navigateTo={navigateTo} startDictation={startDictation} /> : <ManageWords words={words} setWords={setWords} navigateTo={navigateTo} />;
      case Screen.Statistics:
        return <StatisticsDashboard history={history} words={words} theme={theme} />;
      case Screen.Dictionary:
        return <Dictionary words={words} setWords={setWords} selectedVoice={selectedVoice} />;
      default:
        return <PracticeHub words={words} startDictation={startDictation} startListening={startListening} startQuiz={startQuiz} startNewsListening={startNewsListening} navigateTo={navigateTo} />;
    }
  };

  const navLinks = [
      { screen: Screen.PracticeHub, label: 'Practice Hub' },
      { screen: Screen.ManageWords, label: 'Vocabulary' },
      { screen: Screen.Statistics, label: 'Statistics' },
      { screen: Screen.Dictionary, label: 'Dictionary' },
  ];

  return (
    <div className="min-h-screen text-slate-800 dark:text-slate-200 font-sans flex flex-col">
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-4 shadow-sm sticky top-0 z-20 border-b border-slate-200 dark:border-slate-800">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-xl md:text-2xl font-bold text-indigo-600 dark:text-indigo-400">Executive English Lab</h1>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 md:gap-4 text-sm md:text-base">
              {navLinks.map(link => (
                  <button key={link.label} onClick={() => navigateTo(link.screen)} className="font-medium text-slate-600 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                      {link.label}
                  </button>
              ))}
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-full">
                <label htmlFor="voice-select" className="sr-only">Select Voice</label>
                <VoiceIcon />
                <select 
                  id="voice-select"
                  value={selectedVoice} 
                  onChange={e => setSelectedVoice(e.target.value)}
                  className="bg-transparent text-xs focus:ring-0 outline-none border-0"
                >
                    {AVAILABLE_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                </select>
              </div>
              <button onClick={() => setIsAmbientSoundOn(p => !p)} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Toggle Ambient Sound">
                  {isAmbientSoundOn ? <AmbientSoundOnIcon /> : <AmbientSoundOffIcon />}
              </button>
              <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Toggle Theme">
                {theme === 'light' ? <MoonIcon /> : <SunIcon />}
              </button>
          </nav>
          
          {/* Mobile Navigation */}
          <div className="md:hidden">
              <button onClick={() => setIsMobileMenuOpen(true)} className="p-2">
                  <MenuIcon />
              </button>
          </div>
        </div>
      </header>

      {/* Mobile Menu Drawer */}
       {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setIsMobileMenuOpen(false)}>
            <div className="fixed top-0 right-0 h-full w-64 bg-white dark:bg-slate-900 shadow-lg p-4" onClick={e => e.stopPropagation()}>
                <button onClick={() => setIsMobileMenuOpen(false)} className="absolute top-4 right-4 p-2">
                    <CloseIcon />
                </button>
                <nav className="flex flex-col gap-4 mt-12">
                   {navLinks.map(link => (
                      <button key={link.label} onClick={() => navigateTo(link.screen)} className="font-medium text-slate-600 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors text-left p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                          {link.label}
                      </button>
                  ))}
                  <hr className="border-slate-200 dark:border-slate-700" />
                   <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-full">
                      <label htmlFor="voice-select-mobile" className="sr-only">Select Voice</label>
                      <VoiceIcon />
                      <select 
                        id="voice-select-mobile"
                        value={selectedVoice} 
                        onChange={e => setSelectedVoice(e.target.value)}
                        className="bg-transparent text-sm focus:ring-0 outline-none border-0 w-full"
                      >
                          {AVAILABLE_VOICES.map(voice => <option key={voice} value={voice}>{voice}</option>)}
                      </select>
                    </div>
                    <button onClick={() => setIsAmbientSoundOn(p => !p)} className="w-full flex justify-between items-center p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                        <span>Ambient Sound</span>
                        {isAmbientSoundOn ? <AmbientSoundOnIcon /> : <AmbientSoundOffIcon />}
                    </button>
                    <button onClick={toggleTheme} className="w-full flex justify-between items-center p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                        <span>Theme</span>
                      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
                    </button>
                </nav>
            </div>
        </div>
      )}

      <main className="flex-grow container mx-auto p-4 md:p-6">
        {renderScreen()}
      </main>
       <footer className="text-center p-4 text-xs text-slate-500 dark:text-slate-500">
        <p>Powered by Gemini. Built for practice.</p>
      </footer>
    </div>
  );
}


// --- Sub-components ---

interface ManageWordsProps {
  words: Word[];
  setWords: Dispatch<SetStateAction<Word[]>>;
  navigateTo: (screen: Screen) => void;
}
const ManageWords: React.FC<ManageWordsProps> = ({ words, setWords, navigateTo }) => {
  const [newWord, setNewWord] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddWord = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedWord = newWord.trim().toLowerCase();
    if (!cleanedWord || isAdding) return;

    if (words.some(w => w.text.toLowerCase() === cleanedWord)) {
        alert(`The word "${newWord.trim()}" already exists in your list.`);
        setNewWord('');
        return;
    }
    
    setIsAdding(true);
    const translation = await generateTranslation(cleanedWord);

    setWords(prevWords => {
        const newWordObject: Word = { 
            text: cleanedWord, 
            translation: translation || 'Not found',
            errorCount: 0, 
            usageCount: 0, 
            lastUsed: null, 
            dateAdded: new Date().toISOString() 
        };
        const updatedWords = [...prevWords, newWordObject]
            .sort((a, b) => a.text.localeCompare(b.text));
        return updatedWords;
    });

    setNewWord('');
    setIsAdding(false);
  };

  const removeWord = (wordToRemove: string) => {
    setWords(prevWords => prevWords.filter(w => w.text !== wordToRemove));
  };
  
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
        const text = e.target?.result as string;
        const wordsFromCsv = text.split(/[\n,]/).map(w => w.trim().toLowerCase()).filter(Boolean);
        
        const existingWords = new Set(words.map(w => w.text.toLowerCase()));
        const uniqueNewWords = [...new Set(wordsFromCsv.filter(w => !existingWords.has(w)))];

        if (uniqueNewWords.length === 0) {
            alert('No new words found in the file. All words either already exist or the file is empty.');
            setIsUploading(false);
            return;
        }

        const translations = await Promise.all(uniqueNewWords.map(generateTranslation));

        const newWordObjects: Word[] = uniqueNewWords.map((word, index) => ({
            text: word,
            translation: translations[index] || 'Not found',
            errorCount: 0,
            usageCount: 0,
            lastUsed: null,
            dateAdded: new Date().toISOString()
        }));

        setWords(prevWords => 
            [...prevWords, ...newWordObjects].sort((a, b) => a.text.localeCompare(b.text))
        );
        
        alert(`${newWordObjects.length} new words were added and translated.`);
        setIsUploading(false);
    };
    reader.readAsText(file);
    if (event.target) event.target.value = '';
  };

  const handleDownloadWords = () => {
    if (words.length === 0) {
        alert("Your word list is empty.");
        return;
    }
    const header = 'text,translation,errorCount,usageCount,lastUsed,dateAdded\n';
    const csvContent = words.map(w => 
        `"${w.text.replace(/"/g, '""')}","${w.translation || ''}",${w.errorCount},${w.usageCount},${w.lastUsed || ''},${w.dateAdded || ''}`
    ).join('\n');

    const csvData = header + csvContent;
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'dictation_words.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }
  };

  const filteredWords = useMemo(() => {
    return words.filter(word => 
        word.text.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [words, searchTerm]);


  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      <h2 className="text-3xl font-bold mb-6 text-center text-slate-900 dark:text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">Manage Your Words</h2>
      <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-lg shadow-lg backdrop-blur-sm">
        <form onSubmit={handleAddWord} className="flex gap-4 mb-4">
          <input
            type="text"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            placeholder="Enter a new word"
            className="flex-grow bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            disabled={isAdding || isUploading}
          />
          <button type="submit" disabled={isAdding || isUploading} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-lg hover:shadow-indigo-500/50 disabled:bg-slate-400 disabled:shadow-none w-32">
            {isAdding ? <Spinner small /> : 'Add Word'}
          </button>
        </form>
        <div className="flex justify-center gap-4 mb-4">
            <input type="file" accept=".csv,text/plain" onChange={handleFileUpload} ref={fileInputRef} className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="flex items-center justify-center gap-2 bg-slate-500 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-md transition-colors text-sm shadow-md disabled:bg-slate-400 w-32">
              {isUploading ? <Spinner small /> : <><UploadIcon /> Upload</>}
            </button>
            <button onClick={handleDownloadWords} className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-md transition-colors text-sm shadow-md w-32 justify-center">
              <DownloadIcon />
              Download
            </button>
        </div>

        <div className="relative mb-4">
            <SearchIcon />
            <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search your words..."
                className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
        </div>

        <div className="max-h-80 overflow-y-auto pr-2">
            {filteredWords.length > 0 ? (
                <ul className="space-y-2">
                {filteredWords.map(word => (
                    <li key={word.text} className="flex justify-between items-center bg-slate-100 dark:bg-slate-700 p-3 rounded-md">
                    <div>
                        <span className="font-medium">{word.text}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                            Added: {new Date(word.dateAdded).toLocaleDateString()}
                        </span>
                    </div>
                    <button onClick={() => removeWord(word.text)} className="text-slate-500 dark:text-slate-400 hover:text-red-500">
                        <TrashIcon />
                    </button>
                    </li>
                ))}
                </ul>
            ) : (
                <p className="text-center text-slate-500 dark:text-slate-400 py-4">
                    {searchTerm ? `No words found for "${searchTerm}".` : "Your word list is empty. Add some words to get started!"}
                </p>
            )}
        </div>
        {words.length > 0 && (
             <div className="mt-6 text-center">
                 <button onClick={() => navigateTo(Screen.PracticeHub)} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-md transition-all duration-200 text-lg shadow-lg hover:shadow-green-500/50">
                     Go to Practice Hub
                 </button>
            </div>
        )}
      </div>
    </div>
  );
};

interface PracticeHubProps {
    words: Word[];
    startDictation: (dictation: Dictation) => void;
    startListening: (exercise: ListeningExercise) => void;
    startNewsListening: (exercise: NewsListeningExercise) => void;
    startQuiz: (exercise: QuizExercise) => void;
    navigateTo: (screen: Screen) => void;
}
const PracticeHub: React.FC<PracticeHubProps> = ({ words, startDictation, startListening, startNewsListening, startQuiz, navigateTo }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [loadingMessage, setLoadingMessage] = useState('');

    const selectWordsForLevel = (count: number): { selectedWords: Word[], challengeWords: Word[] } => {
        const wordsCopy = [...words];
        const erroredWords = wordsCopy.filter(w => w.errorCount > 0).sort((a, b) => b.errorCount - a.errorCount);
        const nonErroredWords = wordsCopy.filter(w => w.errorCount === 0);
        const newestWords = [...nonErroredWords].sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
        const otherWords = [...nonErroredWords].sort((a, b) => new Date(a.lastUsed || 0).getTime() - new Date(b.lastUsed || 0).getTime());
        
        const selectedWordsSet = new Set<Word>();
        const erroredCount = Math.min(erroredWords.length, Math.ceil(count * 0.4));
        const newestCount = Math.min(newestWords.length, Math.ceil(count * 0.4));
        erroredWords.slice(0, erroredCount).forEach(w => selectedWordsSet.add(w));
        newestWords.forEach(w => {
            if (selectedWordsSet.size < erroredCount + newestCount && !selectedWordsSet.has(w)) selectedWordsSet.add(w);
        });
        otherWords.forEach(w => {
            if (selectedWordsSet.size < count && !selectedWordsSet.has(w)) selectedWordsSet.add(w);
        });
        if (selectedWordsSet.size < count) {
            const allWordsShuffled = wordsCopy.sort(() => Math.random() - 0.5);
            allWordsShuffled.forEach(w => {
                if (selectedWordsSet.size < count && !selectedWordsSet.has(w)) selectedWordsSet.add(w);
            });
        }
        const finalSelectedWords = Array.from(selectedWordsSet).slice(0, count);
        return {
            selectedWords: finalSelectedWords,
            challengeWords: finalSelectedWords.filter(w => w.errorCount > 0),
        }
    };
    
    const handleLevelSelect = async (level: DictationLevel) => {
        setError('');
        const numWordsNeeded = DICTATION_LEVELS[level].count;
        if (words.length < numWordsNeeded) {
            setError(`You need at least ${numWordsNeeded} words for the ${level} level. You have ${words.length}.`);
            return;
        }

        setIsLoading(true);
        setLoadingMessage('Generando contenido...');
        const { selectedWords, challengeWords } = selectWordsForLevel(numWordsNeeded);
        const dictationTextData = await generateDictationText(selectedWords.map(w => w.text), challengeWords.map(w => w.text), level);
        
        if (dictationTextData) {
            setLoadingMessage('Creating a related image...');
            const imageUrl = await generateImageForText(dictationTextData.title);
            startDictation({ ...dictationTextData, imageUrl, level });
        } else {
            setError('Failed to generate dictation. Please try again.');
        }
        setIsLoading(false);
        setLoadingMessage('');
    };
    
    const handleStartListening = async (questionCount: 4 | 8) => {
        setError('');
        if (words.length < 10) {
            setError(`You need at least 10 words for this module.`);
            return;
        }
        setIsLoading(true);
        setLoadingMessage('Generando contenido...');
        const { selectedWords } = selectWordsForLevel(15);
        const exercise = await generateListeningExercise(selectedWords.map(w => w.text), questionCount);
        if (exercise) {
            startListening(exercise);
        } else {
            setError('Failed to generate listening exercise. Please try again.');
        }
        setIsLoading(false);
        setLoadingMessage('');
    };

    const handleStartNewsListening = async (questionCount: 4 | 8) => {
        setError('');
        if (words.length < 10) {
            setError(`You need at least 10 words for this module.`);
            return;
        }
        setIsLoading(true);
        setLoadingMessage('Generando contenido...');
        const { selectedWords } = selectWordsForLevel(15);
        const exercise = await generateNewsListeningExercise(selectedWords.map(w => w.text), questionCount);
        if (exercise) {
            startNewsListening(exercise);
        } else {
            setError('Failed to generate news exercise. Please try again.');
        }
        setIsLoading(false);
        setLoadingMessage('');
    };

    const handleStartQuiz = async () => {
        setError('');
        const wordsNeeded = 5;
        if (words.length < wordsNeeded) {
            setError(`You need at least ${wordsNeeded} words for the Quiz module.`);
            return;
        }
        setIsLoading(true);
        setLoadingMessage('Generando contenido...');
        const { selectedWords } = selectWordsForLevel(10); // select 10 words for quiz
        const exercise = await generateVocabularyQuiz(selectedWords.map(w => w.text));
        if(exercise) {
            startQuiz(exercise);
        } else {
            setError('Failed to generate quiz. Please try again.');
        }
        setIsLoading(false);
        setLoadingMessage('');
    }

    const levelColors: Record<DictationLevel, string> = {
        [DictationLevel.Basic]: "bg-yellow-500 hover:bg-yellow-600",
        [DictationLevel.Intermediate]: "bg-green-600 hover:bg-green-700",
        [DictationLevel.Advanced]: "bg-sky-500 hover:bg-sky-600",
        [DictationLevel.Strategic]: "bg-indigo-600 hover:bg-indigo-700",
    }
    
    if (words.length === 0 && !isLoading) {
        return (
            <div className="max-w-2xl mx-auto text-center animate-fade-in bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-8 rounded-lg shadow-lg">
                <h2 className="text-3xl font-bold mb-4 text-slate-900 dark:text-white">Welcome to the Practice Hub!</h2>
                <p className="text-slate-600 dark:text-slate-300 mb-6">You don't have any words in your list yet. Please add some words to start practicing.</p>
                <button onClick={() => navigateTo(Screen.ManageWords)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-md transition-all duration-200 text-lg shadow-lg hover:shadow-indigo-500/50">
                    Manage Words
                </button>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto text-center animate-fade-in">
            <h2 className="text-3xl font-bold mb-6 text-slate-900 dark:text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">Practice Hub</h2>
            {isLoading ? (
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-8 rounded-lg shadow-lg min-h-[400px] flex items-center justify-center">
                    <Spinner text={loadingMessage} />
                </div>
            ) : (
                <div className="space-y-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                    <div>
                        <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">Classic Dictation</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(DICTATION_LEVELS).map(([level, { count, description }]) => (
                                <button 
                                    key={level}
                                    onClick={() => handleLevelSelect(level as DictationLevel)}
                                    className={`w-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-indigo-500/50 ${levelColors[level as DictationLevel]}`}
                                >
                                    <span className="text-lg">{level}</span>
                                    <span className="block text-sm font-normal text-slate-200">{description} &middot; {count} words</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-white">Advanced Modules</h3>
                         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                             <div className="flex flex-col gap-4">
                                <button onClick={() => handleStartListening(4)} className="flex flex-col items-center justify-center text-left w-full h-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-teal-500/50 bg-teal-600 hover:bg-teal-700">
                                    <div className="flex items-center"><EarIcon /> <span className="text-lg">Listening: Quick Check</span></div>
                                    <span className="block text-sm font-normal text-slate-200 text-center">Short scenario & 4 questions.</span>
                                </button>
                                 <button onClick={() => handleStartListening(8)} className="flex flex-col items-center justify-center text-left w-full h-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-teal-600/50 bg-teal-700 hover:bg-teal-800">
                                    <div className="flex items-center"><EarIcon /> <span className="text-lg">Listening: Deep Dive</span></div>
                                    <span className="block text-sm font-normal text-slate-200 text-center">In-depth scenario & 8 questions.</span>
                                </button>
                             </div>
                              <div className="flex flex-col gap-4">
                                <button onClick={() => handleStartNewsListening(4)} className="flex flex-col items-center justify-center text-left w-full h-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-blue-500/50 bg-blue-600 hover:bg-blue-700">
                                    <div className="flex items-center"><NewspaperIcon /> <span className="text-lg">News: Short Briefing</span></div>
                                    <span className="block text-sm font-normal text-slate-200 text-center">Recent article & 4 questions.</span>
                                </button>
                                 <button onClick={() => handleStartNewsListening(8)} className="flex flex-col items-center justify-center text-left w-full h-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-blue-600/50 bg-blue-700 hover:bg-blue-800">
                                    <div className="flex items-center"><NewspaperIcon /> <span className="text-lg">News: Full Analysis</span></div>
                                    <span className="block text-sm font-normal text-slate-200 text-center">In-depth article & 8 questions.</span>
                                </button>
                             </div>
                             <button onClick={handleStartQuiz} className="flex flex-col items-center justify-center text-left w-full text-white font-bold py-4 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-purple-500/50 bg-purple-600 hover:bg-purple-700 min-h-[140px]">
                                <div className="flex items-center"><QuizIcon /> <span className="text-lg">Vocabulary Quiz</span></div>
                                <span className="block text-sm font-normal text-slate-200 text-center mt-2">Test your knowledge with multiple-choice questions.</span>
                            </button>
                        </div>
                    </div>
                    {error && <p className="text-red-500 dark:text-red-400 mt-4">{error}</p>}
                </div>
            )}
        </div>
    );
};


interface DictationPracticeProps {
    dictation: Dictation;
    onFinish: (result: HistoryEntry) => void;
    selectedVoice: string;
}
const DictationPractice: React.FC<DictationPracticeProps> = ({ dictation, onFinish, selectedVoice }) => {
    const [userInputs, setUserInputs] = useState<string[]>(Array(dictation.wordsToGuess.length).fill(''));
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [wordAudios, setWordAudios] = useState<Record<string, string>>({});
    const [isLoadingAudio, setIsLoadingAudio] = useState(true);
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const urlsToRevokeRef = useRef<string[]>([]);

    const createWavUrlFromBase64 = (base64String: string) => {
        const pcmBytes = decode(base64String);
        const pcmInt16 = new Int16Array(pcmBytes.buffer);
        const wavBlob = encodeWAV(pcmInt16, 24000); // 24kHz sample rate for TTS model
        const url = URL.createObjectURL(wavBlob);
        urlsToRevokeRef.current.push(url);
        return url;
    };

    useEffect(() => {
        const fetchAudio = async () => {
            setIsLoadingAudio(true);
            const mainAudioBase64 = await generateAudio(dictation.fullText, selectedVoice);
            if (mainAudioBase64) {
                 setAudioUrl(createWavUrlFromBase64(mainAudioBase64));
            }
            
            const individualAudios: Record<string, string> = {};
            for (const word of dictation.shuffledWords) {
                const wordAudioBase64 = await generateAudio(word, selectedVoice);
                if (wordAudioBase64) {
                    individualAudios[word] = createWavUrlFromBase64(wordAudioBase64);
                }
            }
            setWordAudios(individualAudios);
            setIsLoadingAudio(false);
        };
        fetchAudio();
        
        return () => {
            urlsToRevokeRef.current.forEach(URL.revokeObjectURL);
            urlsToRevokeRef.current = [];
        }
    }, [dictation, selectedVoice]);

    const handleInputChange = (index: number, value: string) => {
        const newInputs = [...userInputs];
        newInputs[index] = value;
        setUserInputs(newInputs);
    };

    const playWordAudio = (word: string) => {
        if (wordAudios[word]) {
            const audio = new Audio(wordAudios[word]);
            audio.play().catch(e => console.error("Error playing audio:", e));
        }
    };
    
    const handleSubmit = () => {
        let correctCount = 0;
        const errors: { word: string; userInput: string }[] = [];
        
        dictation.wordsToGuess.forEach((word, index) => {
            if (userInputs[index].trim().toLowerCase() === word.toLowerCase()) {
                correctCount++;
            } else {
                errors.push({ word, userInput: userInputs[index] });
            }
        });
        
        const result: HistoryEntry = {
            id: new Date().toISOString(),
            date: new Date().toISOString(),
            type: SessionType.Dictation,
            level: dictation.level,
            score: (correctCount / dictation.wordsToGuess.length) * 100,
            totalWords: dictation.wordsToGuess.length,
            correctWords: correctCount,
            errors,
        };
        onFinish(result);
    };
    
    // Audio Player Logic
    const togglePlayPause = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play().catch(e => console.error("Error playing audio:", e));
            }
            setIsPlaying(!isPlaying);
        }
    };
    
    const handleRewind = (seconds: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - seconds);
        }
    };

    const handleTimeUpdate = () => {
        if (audioRef.current && audioRef.current.duration) {
            setProgress((audioRef.current.currentTime / audioRef.current.duration) * 100);
        }
    };

    const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (audioRef.current && audioRef.current.duration) {
            const newTime = (Number(e.target.value) / 100) * audioRef.current.duration;
            audioRef.current.currentTime = newTime;
            setProgress(Number(e.target.value));
        }
    }
    
    const handleAudioEnded = () => {
        setIsPlaying(false);
        setProgress(0);
    };

    if (isLoadingAudio) {
        return <div className="flex flex-col items-center justify-center"><Spinner text="Loading audio..." /></div>;
    }

    let inputIndex = -1;

    return (
        <div className="grid lg:grid-cols-3 gap-8 animate-fade-in">
            <div className="lg:col-span-2 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                {dictation.imageUrl && (
                    <img 
                        src={`data:image/png;base64,${dictation.imageUrl}`} 
                        alt={dictation.title}
                        className="w-full h-48 object-cover rounded-lg mb-4"
                    />
                )}
                <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">{dictation.title}</h2>
                {audioUrl && (
                    <div className="mb-6 bg-slate-100 dark:bg-slate-700 p-3 rounded-lg flex items-center gap-2">
                        <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={handleAudioEnded}></audio>
                        <button onClick={togglePlayPause} className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300">
                           {isPlaying ? <PauseIcon/> : <PlayIcon />}
                        </button>
                        <button onClick={() => handleRewind(2)} title="Rewind 2s" className="text-slate-500 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                            <RewindIcon />
                        </button>
                        <select onChange={e => { if(audioRef.current) audioRef.current.playbackRate = parseFloat(e.target.value)}} defaultValue="1" className="bg-slate-200 dark:bg-slate-600 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none">
                            <option value="0.5">0.5x</option>
                            <option value="0.75">0.75x</option>
                            <option value="1">1x</option>
                            <option value="1.25">1.25x</option>
                            <option value="1.5">1.5x</option>
                        </select>
                        <input type="range" value={progress} onChange={handleProgressChange} className="w-full h-2 bg-slate-300 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                    </div>
                )}
                <div className="text-lg leading-relaxed">
                    {dictation.textParts.map((part, i) => {
                        if (i < dictation.textParts.length - 1) {
                            inputIndex++;
                            const currentIndex = inputIndex;
                            return (
                                <React.Fragment key={i}>
                                    {part}
                                    <input
                                        type="text"
                                        value={userInputs[currentIndex]}
                                        onChange={e => handleInputChange(currentIndex, e.target.value)}
                                        className="inline-block w-32 bg-slate-100 dark:bg-slate-700 border-b-2 border-slate-400 dark:border-slate-500 focus:border-indigo-500 dark:focus:border-indigo-400 text-center mx-1 rounded-t-sm focus:outline-none transition-colors"
                                    />
                                </React.Fragment>
                            );
                        }
                        return <span key={i}>{part}</span>;
                    })}
                </div>
                <div className="mt-8 text-center">
                    <button onClick={handleSubmit} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-md text-lg shadow-lg hover:shadow-green-500/50">Check Answers</button>
                </div>
            </div>

            <div className="bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                <h3 className="text-xl font-bold mb-4 text-slate-900 dark:text-white">Word Bank</h3>
                <ul className="space-y-2">
                    {dictation.shuffledWords.map(word => (
                        <li key={word} className="bg-slate-100 dark:bg-slate-700 p-3 rounded-md flex justify-between items-center">
                            <span>{word}</span>
                            {wordAudios[word] && <button onClick={() => playWordAudio(word)} className="text-slate-500 dark:text-slate-300 hover:text-indigo-500 dark:hover:text-indigo-400"><SpeakerIcon /></button>}
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};


interface ResultsProps {
    result: HistoryEntry;
    words: Word[];
    navigateTo: (screen: Screen) => void;
    startDictation: (dictation: Dictation) => void;
}
const Results: React.FC<ResultsProps> = ({ result, words, navigateTo, startDictation }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [aiFeedback, setAiFeedback] = useState<string | null>(null);
    const [isFeedbackLoading, setIsFeedbackLoading] = useState(true);

    useEffect(() => {
        const getFeedback = async () => {
            setIsFeedbackLoading(true);
            const feedback = await generatePersonalizedFeedback(result, words);
            setAiFeedback(feedback);
            setIsFeedbackLoading(false);
        };
        getFeedback();
    }, [result, words]);


    const retryIncorrect = async () => {
        if (result.type !== SessionType.Dictation) return;
        const incorrectWords = result.errors.map(e => e.word);
        if (incorrectWords.length === 0) return;

        setIsLoading(true);
        const challengeWords = words.filter(w => incorrectWords.includes(w.text) && w.errorCount > 0).map(w => w.text);
        const dictationTextData = await generateDictationText(incorrectWords, challengeWords, result.level);
        if (dictationTextData) {
            const imageUrl = await generateImageForText(dictationTextData.title);
            startDictation({ ...dictationTextData, imageUrl, level: result.level });
        } else {
            alert('Failed to generate retry dictation.');
        }
        setIsLoading(false);
    };
    
    const getResultTitle = () => {
        switch (result.type) {
            case SessionType.Dictation: return 'Dictation Results';
            case SessionType.Listening: return 'Listening Comprehension Results';
            case SessionType.NewsListening: return 'News Briefing Results';
            case SessionType.Quiz: return 'Vocabulary Quiz Results';
        }
    };

    const renderResultDetails = () => {
        switch (result.type) {
            case SessionType.Dictation:
                return (
                    <>
                        <p className="text-lg text-slate-500 dark:text-slate-400 mb-6">{result.level} Level</p>
                        <div className="mb-8">
                            <p className="text-5xl font-bold text-slate-900 dark:text-white">{result.score.toFixed(1)}%</p>
                            <p className="text-slate-600 dark:text-slate-300">{result.correctWords} / {result.totalWords} correct</p>
                        </div>
                         {result.errors.length > 0 && (
                            <div className="text-left mb-8">
                                <h3 className="text-xl font-bold mb-4 text-red-500 dark:text-red-400">Words to Review</h3>
                                <ul className="space-y-3">
                                {result.errors.map(({ word, userInput }, index) => (
                                    <li key={index} className="bg-slate-100 dark:bg-slate-700 p-3 rounded-md">
                                        <p className="font-bold text-green-600 dark:text-green-400">{word}</p>
                                        <p className="text-sm">You wrote: <span className="text-red-500 dark:text-red-400 font-mono">{userInput || '""'}</span></p>
                                    </li>
                                ))}
                                </ul>
                            </div>
                        )}
                    </>
                );
            case SessionType.Listening:
            case SessionType.NewsListening:
                const correctCount = result.userAnswers.filter((a, i) => a === result.questions[i].correctAnswer).length;
                return (
                     <>
                        <p className="text-lg text-slate-500 dark:text-slate-400 mb-6">{result.exerciseTitle}</p>
                        <div className="mb-8">
                            <p className="text-5xl font-bold text-slate-900 dark:text-white">{result.score.toFixed(1)}%</p>
                            <p className="text-slate-600 dark:text-slate-300">{correctCount} / {result.questions.length} correct</p>
                        </div>
                        <div className="text-left mb-8">
                            <h3 className="text-xl font-bold mb-4 text-slate-700 dark:text-slate-200">Question Breakdown</h3>
                            <ul className="space-y-3">
                                {result.questions.map((q, i) => (
                                    <li key={i} className={`p-3 rounded-md ${result.userAnswers[i] === q.correctAnswer ? 'bg-green-100 dark:bg-green-900/50' : 'bg-red-100 dark:bg-red-900/50'}`}>
                                        <p className="font-semibold">{q.question} <span className="text-xs font-normal bg-slate-200 dark:bg-slate-700 px-2 py-0.5 rounded-full">{q.questionType}</span></p>
                                        <p className="text-sm mt-1">Correct answer: <span className="font-bold">{q.correctAnswer}</span></p>
                                        {result.userAnswers[i] !== q.correctAnswer && <p className="text-sm">You answered: <span className="font-bold">{result.userAnswers[i] || "No answer"}</span></p>}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </>
                );
            case SessionType.Quiz:
                return (
                    <>
                        <p className="text-lg text-slate-500 dark:text-slate-400 mb-6">{result.title}</p>
                        <div className="mb-8">
                            <p className="text-5xl font-bold text-slate-900 dark:text-white">{result.score.toFixed(1)}%</p>
                            <p className="text-slate-600 dark:text-slate-300">{result.correctAnswersCount} / {result.questions.length} correct</p>
                        </div>
                        <div className="text-left mb-8">
                             <h3 className="text-xl font-bold mb-4 text-slate-700 dark:text-slate-200">Review</h3>
                             <ul className="space-y-3">
                                {result.questions.map((q, i) => (
                                    <li key={i} className={`p-3 rounded-md ${result.userAnswers[i] === q.correctAnswer ? 'bg-green-100 dark:bg-green-900/50' : 'bg-red-100 dark:bg-red-900/50'}`}>
                                        <p className="font-semibold">Q: {q.question}</p>
                                        <p className="text-sm mt-1">Correct: <span className="font-bold">{q.correctAnswer}</span></p>
                                        {result.userAnswers[i] !== q.correctAnswer && <p className="text-sm">You: <span className="font-bold">{result.userAnswers[i]}</span></p>}
                                    </li>
                                ))}
                             </ul>
                        </div>
                    </>
                );
        }
    }

    return (
        <div className="max-w-3xl mx-auto text-center animate-fade-in bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-8 rounded-lg shadow-lg">
            <h2 className="text-3xl font-bold mb-2 text-slate-900 dark:text-white">{getResultTitle()}</h2>
            
            {renderResultDetails()}

            <div className="text-center bg-indigo-50 dark:bg-slate-900/50 p-4 rounded-lg mb-8 border border-indigo-200 dark:border-indigo-900">
                 <h3 className="font-bold text-indigo-800 dark:text-indigo-300 mb-2">Your AI Coach says...</h3>
                 {isFeedbackLoading ? (
                    <Spinner />
                 ) : (
                    <p className="italic text-indigo-700 dark:text-indigo-300">{aiFeedback || "Excellent work! Every practice session is a step forward."}</p>
                 )}
            </div>

            <div className="flex justify-center gap-4">
                <button onClick={() => navigateTo(Screen.PracticeHub)} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-6 rounded-md shadow-lg hover:shadow-indigo-500/50">New Exercise</button>
                {result.type === SessionType.Dictation && result.errors.length > 0 && (
                    <button onClick={retryIncorrect} disabled={isLoading} className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-6 rounded-md disabled:bg-slate-400 dark:disabled:bg-slate-600 shadow-lg hover:shadow-orange-500/50">
                        {isLoading ? <Spinner /> : `Retry ${result.errors.length} Incorrect Word(s)`}
                    </button>
                )}
            </div>
        </div>
    );
};

interface StatisticsDashboardProps {
    history: HistoryEntry[];
    words: Word[];
    theme: string;
}
const StatisticsDashboard: React.FC<StatisticsDashboardProps> = ({ history, words, theme }) => {
    const [isReportModalOpen, setIsReportModalOpen] = useState(false);
    const [weeklyReport, setWeeklyReport] = useState<string | null>(null);
    const [isReportLoading, setIsReportLoading] = useState(false);

    const chartData = useMemo(() => {
        const reversedHistory = [...history].reverse();
        return {
            overall: reversedHistory.map(entry => ({
                date: new Date(entry.date).toLocaleDateString(),
                Score: entry.score,
            })),
            listening: reversedHistory.filter(e => e.type === SessionType.Listening || e.type === SessionType.NewsListening).map(entry => ({
                date: new Date(entry.date).toLocaleDateString(),
                'Listening Score': entry.score,
            })),
        }
    }, [history]);
    
    const weeklyFrequencyData = useMemo(() => {
        const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const counts = Array(7).fill(0);
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        history.forEach(entry => {
            const entryDate = new Date(entry.date);
            if (entryDate > oneWeekAgo) {
                counts[entryDate.getDay()]++;
            }
        });
        return weekDays.map((day, i) => ({ name: day, Sessions: counts[i] }));
    }, [history]);

    const listeningScores = history.filter(h => h.type === SessionType.Listening || h.type === SessionType.NewsListening).map(h => h.score);
    const avgListeningScore = listeningScores.length > 0 ? listeningScores.reduce((a, b) => a + b, 0) / listeningScores.length : 0;
    const gaugeData = [{ name: 'Listening Avg', value: avgListeningScore }];

    const wordsToPractice = useMemo(() => {
        return words.filter(w => w.errorCount > 0).sort((a,b) => b.errorCount - a.errorCount).slice(0, 10);
    }, [words]);

    const handleGenerateReport = async () => {
        setIsReportLoading(true);
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const weeklyHistory = history.filter(entry => new Date(entry.date) > oneWeekAgo);
        const report = await generateStatisticsReport(weeklyHistory);
        setWeeklyReport(report);
        setIsReportLoading(false);
    }

    return (
        <div className="animate-fade-in space-y-6">
             <div className="flex justify-between items-center">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">Statistics Dashboard</h2>
                <button onClick={() => { setIsReportModalOpen(true); setWeeklyReport(null); }} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-md transition-all duration-200 shadow-lg hover:shadow-indigo-500/50">
                    <ChartBarIcon />
                    AI Weekly Report
                </button>
            </div>
            
            {isReportModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-20" onClick={() => setIsReportModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 p-6 rounded-lg shadow-2xl max-w-lg w-full m-4" onClick={e => e.stopPropagation()}>
                        <h3 className="text-xl font-bold mb-4 text-indigo-600 dark:text-indigo-400">AI Weekly Report</h3>
                         <div className="bg-slate-100 dark:bg-slate-900/50 p-4 rounded-lg min-h-[200px] max-h-[60vh] overflow-y-auto">
                            {isReportLoading ? (
                                <div className="flex items-center justify-center h-full"><Spinner text="Analyzing your week..." /></div>
                            ) : weeklyReport ? (
                                <SimpleMarkdownRenderer text={weeklyReport} />
                            ) : (
                                <div className="text-center flex flex-col items-center justify-center h-full">
                                    <p className="mb-4">Get an AI-powered summary of your performance over the last 7 days.</p>
                                    <button onClick={handleGenerateReport} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 px-4 rounded-md shadow-lg hover:shadow-green-500/50">
                                        Generate Now
                                    </button>
                                </div>
                            )}
                         </div>
                        <button onClick={() => setIsReportModalOpen(false)} className="mt-6 w-full bg-slate-500 hover:bg-slate-600 text-white font-bold py-2 px-4 rounded-md">Close</button>
                    </div>
                </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-lg shadow-lg lg:col-span-2">
                    <h3 className="text-xl font-bold mb-4">Overall Score Trend</h3>
                    {history.length > 1 ? (
                        <ResponsiveContainer width="100%" height={300}>
                            <LineChart data={chartData.overall}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100, 116, 139, 0.3)" />
                                <XAxis dataKey="date" stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} />
                                <YAxis stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} domain={[0, 100]} />
                                {/* FIX: Used the aliased `RechartsTooltip` to prevent conflict with the custom Tooltip component. */}
                                <RechartsTooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#1e293b' : 'rgba(255, 255, 255, 0.9)', border: '1px solid #334155' }} />
                                <Legend />
                                <Line type="monotone" dataKey="Score" stroke="#4f46e5" strokeWidth={2} activeDot={{ r: 8 }} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    ) : (
                        <p className="text-center text-slate-500 dark:text-slate-300 h-[300px] flex items-center justify-center">Complete more sessions to see your progress chart.</p>
                    )}
                </div>
                 <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-bold mb-4">Challenge Words</h3>
                    <div className="h-[300px] overflow-y-auto pr-2 text-center">
                        {wordsToPractice.length > 0 ? (
                            <div className="flex flex-wrap gap-2 justify-center items-center h-full">
                                {wordsToPractice.map(word => (
                                    <div key={word.text} className="bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 rounded-full px-3 py-1 text-sm font-medium">
                                        {word.text}
                                        <span className="ml-2 text-xs opacity-75">({word.errorCount})</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                             <p className="text-center text-slate-500 dark:text-slate-300 h-full flex items-center justify-center">No problem words yet. Great job!</p>
                        )}
                    </div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-bold mb-4">Weekly Practice Frequency</h3>
                     <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={weeklyFrequencyData}>
                            <XAxis dataKey="name" stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} />
                            <YAxis stroke={theme === 'dark' ? '#94a3b8' : '#64748b'} allowDecimals={false}/>
                            {/* FIX: Used the aliased `RechartsTooltip` to prevent conflict with the custom Tooltip component. */}
                            <RechartsTooltip contentStyle={{ backgroundColor: theme === 'dark' ? '#1e293b' : 'rgba(255, 255, 255, 0.9)', border: '1px solid #334155' }} />
                            <Bar dataKey="Sessions" fill="#10b981" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm p-6 rounded-lg shadow-lg">
                    <h3 className="text-xl font-bold mb-4">Listening Comprehension</h3>
                     <ResponsiveContainer width="100%" height={200}>
                        <RadialBarChart innerRadius="70%" outerRadius="100%" data={gaugeData} startAngle={90} endAngle={-270}>
                            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
                            <RadialBar background dataKey="value" cornerRadius={10} angleAxisId={0} fill="#0ea5e9" />
                             <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-4xl font-bold fill-current">
                                {avgListeningScore.toFixed(0)}%
                            </text>
                        </RadialBarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
};

// --- New Advanced Module Components ---

interface ListeningPracticeProps {
    exercise: ListeningExercise | NewsListeningExercise;
    onFinish: (result: HistoryEntry) => void;
    selectedVoice: string;
}
const ListeningPractice: React.FC<ListeningPracticeProps> = ({ exercise, onFinish, selectedVoice }) => {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState(true);
    const [hasFinishedListening, setHasFinishedListening] = useState(false);
    const [userAnswers, setUserAnswers] = useState<string[]>(Array(exercise.questions.length).fill(''));
    const audioRef = useRef<HTMLAudioElement>(null);
    
    useEffect(() => {
        const fetchAudio = async () => {
            setIsLoadingAudio(true);
            const base64 = await generateAudio(exercise.fullText, selectedVoice);
            if(base64) {
                 const pcmBytes = decode(base64);
                const pcmInt16 = new Int16Array(pcmBytes.buffer);
                const wavBlob = encodeWAV(pcmInt16, 24000);
                const url = URL.createObjectURL(wavBlob);
                setAudioUrl(url);
                return () => URL.revokeObjectURL(url);
            }
            setIsLoadingAudio(false);
        };
        const cleanup = fetchAudio();
        return () => { cleanup.then(cf => cf && cf()); }
    }, [exercise, selectedVoice]);

    const handleAnswerSelect = (questionIndex: number, answer: string) => {
        const newAnswers = [...userAnswers];
        newAnswers[questionIndex] = answer;
        setUserAnswers(newAnswers);
    };

    const handleSubmit = () => {
        let correctCount = 0;
        const questionTypeStats: Record<string, {correct: number, total: number}> = {};

        exercise.questions.forEach((q, i) => {
            if(!questionTypeStats[q.questionType]) {
                questionTypeStats[q.questionType] = { correct: 0, total: 0 };
            }
            questionTypeStats[q.questionType].total++;
            if (userAnswers[i] === q.correctAnswer) {
                correctCount++;
                questionTypeStats[q.questionType].correct++;
            }
        });

        const result: HistoryEntry = {
            id: new Date().toISOString(),
            date: new Date().toISOString(),
            type: SessionType.Listening,
            score: (correctCount / exercise.questions.length) * 100,
            exerciseTitle: exercise.title,
            questions: exercise.questions,
            userAnswers: userAnswers,
            questionTypeStats: Object.entries(questionTypeStats).map(([type, stats]) => ({ type: type as any, ...stats })),
        };
        onFinish(result);
    };
    
    if (isLoadingAudio || !audioUrl) {
         return <div className="flex flex-col items-center justify-center"><Spinner text="Loading audio scenario..." /></div>;
    }

    return (
        <div className="max-w-3xl mx-auto animate-fade-in bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-8 rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">Strategic Listening & Comprehension</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">{exercise.title}</p>
            
            <audio ref={audioRef} src={audioUrl} controls className="w-full mb-6" onEnded={() => setHasFinishedListening(true)} />

            {hasFinishedListening && (
                <div className="space-y-6 animate-fade-in">
                    <h3 className="text-xl font-semibold">Comprehension Questions</h3>
                    {exercise.questions.map((q, qIndex) => (
                        <div key={qIndex} className="text-left bg-slate-100 dark:bg-slate-700/50 p-4 rounded-lg">
                            <p className="font-semibold">{qIndex + 1}. {q.question}</p>
                            <div className="mt-3 space-y-2">
                                {q.options.map((option, oIndex) => (
                                    <label key={oIndex} className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer">
                                        <input 
                                            type="radio"
                                            name={`question-${qIndex}`}
                                            value={option}
                                            checked={userAnswers[qIndex] === option}
                                            onChange={() => handleAnswerSelect(qIndex, option)}
                                            className="form-radio text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span>{option}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                    <button onClick={handleSubmit} disabled={userAnswers.some(a => a === '')} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-md text-lg disabled:bg-slate-400 dark:disabled:bg-slate-600 shadow-lg hover:shadow-green-500/50">
                        Submit Answers
                    </button>
                </div>
            )}
        </div>
    );
};

const NewsListeningPractice: React.FC<Omit<ListeningPracticeProps, 'exercise'> & { exercise: NewsListeningExercise }> = ({ exercise, onFinish, selectedVoice }) => {
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState(true);
    const [hasFinishedListening, setHasFinishedListening] = useState(false);
    const [userAnswers, setUserAnswers] = useState<string[]>(Array(exercise.questions.length).fill(''));
    
    useEffect(() => {
        const fetchAudio = async () => {
            setIsLoadingAudio(true);
            const base64 = await generateAudio(exercise.fullText, selectedVoice);
            if(base64) {
                 const pcmBytes = decode(base64);
                const pcmInt16 = new Int16Array(pcmBytes.buffer);
                const wavBlob = encodeWAV(pcmInt16, 24000);
                const url = URL.createObjectURL(wavBlob);
                setAudioUrl(url);
                 return () => URL.revokeObjectURL(url);
            }
            setIsLoadingAudio(false);
        };
        const cleanup = fetchAudio();
         return () => { cleanup.then(cf => cf && cf()); }
    }, [exercise, selectedVoice]);

    const handleAnswerSelect = (questionIndex: number, answer: string) => {
        const newAnswers = [...userAnswers];
        newAnswers[questionIndex] = answer;
        setUserAnswers(newAnswers);
    };

    const handleSubmit = () => {
        let correctCount = 0;
        exercise.questions.forEach((q, i) => {
            if (userAnswers[i] === q.correctAnswer) correctCount++;
        });

        const result: HistoryEntry = {
            id: new Date().toISOString(),
            date: new Date().toISOString(),
            type: SessionType.NewsListening,
            score: (correctCount / exercise.questions.length) * 100,
            exerciseTitle: exercise.title,
            source: exercise.source,
            questions: exercise.questions,
            userAnswers: userAnswers,
        };
        onFinish(result);
    };
    
    if (isLoadingAudio || !audioUrl) {
         return <div className="flex flex-col items-center justify-center"><Spinner text="Loading audio briefing..." /></div>;
    }

    return (
        <div className="max-w-3xl mx-auto animate-fade-in bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-8 rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">Strategic News Listening</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-1 text-sm">Source: {exercise.source}</p>
            <p className="text-slate-600 dark:text-slate-300 mb-4 font-semibold">{exercise.title}</p>
            
            <audio src={audioUrl} controls className="w-full mb-6" onEnded={() => setHasFinishedListening(true)} />

            {hasFinishedListening && (
                <div className="space-y-6 animate-fade-in">
                    <h3 className="text-xl font-semibold">Comprehension Questions</h3>
                    {exercise.questions.map((q, qIndex) => (
                        <div key={qIndex} className="text-left bg-slate-100 dark:bg-slate-700/50 p-4 rounded-lg">
                            <p className="font-semibold">{qIndex + 1}. {q.question}</p>
                            <div className="mt-3 space-y-2">
                                {q.options.map((option, oIndex) => (
                                    <label key={oIndex} className="flex items-center gap-3 p-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-600 cursor-pointer">
                                        <input 
                                            type="radio"
                                            name={`question-${qIndex}`}
                                            value={option}
                                            checked={userAnswers[qIndex] === option}
                                            onChange={() => handleAnswerSelect(qIndex, option)}
                                            className="form-radio text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span>{option}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    ))}
                    <button onClick={handleSubmit} disabled={userAnswers.some(a => a === '')} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-md text-lg disabled:bg-slate-400 dark:disabled:bg-slate-600 shadow-lg hover:shadow-green-500/50">
                        Submit Answers
                    </button>
                </div>
            )}
        </div>
    );
};


interface VocabularyQuizProps {
    exercise: QuizExercise;
    onFinish: (result: HistoryEntry) => void;
}
const VocabularyQuizPractice: React.FC<VocabularyQuizProps> = ({ exercise, onFinish }) => {
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [userAnswers, setUserAnswers] = useState<string[]>(Array(exercise.questions.length).fill(''));
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);

    const handleAnswerSelect = (answer: string) => {
        setSelectedAnswer(answer);
    };

    const handleNextQuestion = () => {
        const newAnswers = [...userAnswers];
        newAnswers[currentQuestionIndex] = selectedAnswer || '';
        setUserAnswers(newAnswers);
        setSelectedAnswer(null);

        if (currentQuestionIndex < exercise.questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        } else {
            // Finish quiz
            let correctCount = 0;
            newAnswers.forEach((answer, index) => {
                if(answer === exercise.questions[index].correctAnswer) {
                    correctCount++;
                }
            });
            
            const result: HistoryEntry = {
                id: new Date().toISOString(),
                date: new Date().toISOString(),
                type: SessionType.Quiz,
                score: (correctCount / exercise.questions.length) * 100,
                title: exercise.title,
                questions: exercise.questions,
                userAnswers: newAnswers,
                correctAnswersCount: correctCount,
            };
            onFinish(result);
        }
    };
    
    const currentQuestion = exercise.questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / exercise.questions.length) * 100;

    return (
         <div className="max-w-2xl mx-auto animate-fade-in bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm p-8 rounded-lg shadow-lg">
            <h2 className="text-2xl font-bold mb-2 text-slate-900 dark:text-white">{exercise.title}</h2>
            <p className="text-slate-500 dark:text-slate-400 mb-4 text-sm">Question {currentQuestionIndex + 1} of {exercise.questions.length}</p>
            
            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2.5 mb-6">
                <div className="bg-indigo-600 h-2.5 rounded-full" style={{ width: `${progress}%`, transition: 'width 0.3s' }}></div>
            </div>

            <div className="text-left my-6">
                <p className="text-lg font-semibold">{currentQuestion.question}</p>
                <div className="mt-4 space-y-3">
                    {currentQuestion.options.map((option, index) => (
                        <label key={index} className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${selectedAnswer === option ? 'bg-indigo-100 dark:bg-indigo-900/50 border-indigo-500' : 'bg-slate-100 dark:bg-slate-700/50 border-transparent hover:border-slate-300 dark:hover:border-slate-600'}`}>
                             <input 
                                type="radio"
                                name="quiz-option"
                                value={option}
                                checked={selectedAnswer === option}
                                onChange={() => handleAnswerSelect(option)}
                                className="form-radio text-indigo-600 focus:ring-indigo-500 h-5 w-5"
                            />
                            <span className="text-base">{option}</span>
                        </label>
                    ))}
                </div>
            </div>

            <button onClick={handleNextQuestion} disabled={!selectedAnswer} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-md text-lg disabled:bg-slate-400 dark:disabled:bg-slate-600 shadow-lg hover:shadow-green-500/50">
                {currentQuestionIndex < exercise.questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
            </button>
         </div>
    );
};

// --- New Dictionary Component ---

const WordRow: React.FC<{ word: Word; selectedVoice: string; }> = ({ word, selectedVoice }) => {
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handlePlayPronunciation = async () => {
        if (isLoadingAudio) return;
        setIsLoadingAudio(true);
        try {
            const base64 = await generateAudio(word.text, selectedVoice);
            if (base64) {
                const pcmBytes = decode(base64);
                const pcmInt16 = new Int16Array(pcmBytes.buffer);
                const wavBlob = encodeWAV(pcmInt16, 24000);
                const url = URL.createObjectURL(wavBlob);
                if (audioRef.current) {
                    URL.revokeObjectURL(audioRef.current.src);
                }
                const audio = new Audio(url);
                audioRef.current = audio;
                audio.play().catch(e => console.error("Error playing audio:", e));
            }
        } catch (error) {
            console.error("Failed to generate or play audio:", error);
        } finally {
            setIsLoadingAudio(false);
        }
    };
    
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                URL.revokeObjectURL(audioRef.current.src);
            }
        };
    }, []);

    return (
        <tr className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <td className="p-4 font-medium text-slate-900 dark:text-white align-middle">{word.text}</td>
            <td className="p-4 text-slate-500 dark:text-slate-400 align-middle">{word.translation || '...'}</td>
            <td className="p-4 text-center align-middle">
                <button 
                    onClick={handlePlayPronunciation} 
                    disabled={isLoadingAudio} 
                    className="text-slate-500 dark:text-slate-400 hover:text-indigo-500 disabled:opacity-50 transition-colors"
                    aria-label={`Listen to ${word.text}`}
                >
                    {isLoadingAudio ? (
                        <svg className="animate-spin h-5 w-5 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <SpeakerIcon className="w-5 h-5" />
                    )}
                </button>
            </td>
        </tr>
    );
};


const Dictionary: React.FC<{ words: Word[]; setWords: Dispatch<SetStateAction<Word[]>>; selectedVoice: string; }> = ({ words, setWords, selectedVoice }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isBackfilling, setIsBackfilling] = useState(false);

    useEffect(() => {
        const backfillTranslations = async () => {
            const wordsToTranslate = words.filter(w => typeof w.translation === 'undefined');
            if (wordsToTranslate.length === 0) return;

            setIsBackfilling(true);
            
            const translations = await Promise.all(
                wordsToTranslate.map(word => 
                    generateTranslation(word.text).then(translation => ({
                        text: word.text,
                        translation: translation || 'Not found'
                    }))
                )
            );

            const translationMap = new Map(translations.map(t => [t.text, t.translation]));

            setWords(prevWords => 
                prevWords.map(word => 
                    translationMap.has(word.text) 
                        ? { ...word, translation: translationMap.get(word.text) } 
                        : word
                )
            );
            setIsBackfilling(false);
        };

        backfillTranslations();
    }, []); // Run only once on component mount

    
    const filteredWords = useMemo(() => {
        return words.filter(word => 
            word.text.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [words, searchTerm]);

    return (
         <div className="max-w-3xl mx-auto animate-fade-in">
            <h2 className="text-3xl font-bold mb-6 text-center text-slate-900 dark:text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.25)] dark:drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]">My Dictionary</h2>
            <div className="bg-white/80 dark:bg-slate-900/80 p-6 rounded-lg shadow-lg backdrop-blur-sm">
                <div className="relative mb-4">
                    <SearchIcon />
                    <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder={`Search your ${words.length} words...`}
                        className="w-full bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-md pl-10 pr-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </div>
                {isBackfilling && (
                    <div className="text-center p-2 text-sm text-slate-500 dark:text-slate-400">
                        <p>Updating dictionary with new translations...</p>
                    </div>
                )}
                <div className="max-h-[60vh] overflow-y-auto">
                     {filteredWords.length > 0 ? (
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-slate-100/80 dark:bg-slate-800/80 backdrop-blur-sm">
                                <tr>
                                    <th className="p-4 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Word</th>
                                    <th className="p-4 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Meaning</th>
                                    <th className="p-4 text-sm font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">Listen</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredWords.map(word => (
                                    <WordRow 
                                        key={word.text} 
                                        word={word} 
                                        selectedVoice={selectedVoice} 
                                    />
                                ))}
                            </tbody>
                        </table>
                    ) : (
                         <p className="text-center text-slate-500 dark:text-slate-400 py-8">
                            {searchTerm ? `No words found for "${searchTerm}".` : "Your dictionary is empty."}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};