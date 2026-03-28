import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, ThumbsUp, ThumbsDown, Mic, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { ChatMessage, initialMessages } from '@/lib/dummyData';
import { sendAgentMessage, transcribeAudio } from '@/lib/agentApi';

const quickActions = [
  '📅 Book a meeting tomorrow at 3 PM',
  '📋 Show my schedule',
  '🔄 Reschedule client call',
  '⚠️ Check for conflicts',
];

export const ChatPanel = () => {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMicSupported, setIsMicSupported] = useState(true);
  const [feedbacks, setFeedbacks] = useState<Record<string, 'up' | 'down'>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setIsMicSupported(false);
      return;
    }

    return () => {
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const toggleVoiceInput = async () => {
    if (!isMicSupported) {
      return;
    }

    if (isListening) {
      mediaRecorderRef.current?.stop();
      setIsListening(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      mediaStreamRef.current = stream;

      const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const selectedMimeType = preferredMimeTypes.find((m) => MediaRecorder.isTypeSupported(m));
      const recorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          if (audioBlob.size < 1024) {
            setMessages((prev) => [
              ...prev,
              {
                id: (Date.now() + 2).toString(),
                role: 'assistant',
                content: 'No audible voice captured. Please hold the mic button, speak for at least 1-2 seconds, then stop.',
                timestamp: new Date(),
              },
            ]);
            return;
          }

          const locale = navigator.language || 'en-US';
          const result = await transcribeAudio(audioBlob, locale);
          setInput((prev) => [prev.trim(), result.text.trim()].filter(Boolean).join(' '));
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Transcription failed.';
          setMessages((prev) => [
            ...prev,
            {
              id: (Date.now() + 2).toString(),
              role: 'assistant',
              content: `Voice transcription failed. ${msg}`,
              timestamp: new Date(),
            },
          ]);
        } finally {
          setIsListening(false);
          mediaRecorderRef.current = null;
          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
          }
          audioChunksRef.current = [];
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(200);
      setIsListening(true);
    } catch {
      setIsListening(false);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 2).toString(),
          role: 'assistant',
          content: 'Microphone access failed. Please allow microphone permissions and try again.',
          timestamp: new Date(),
        },
      ]);
    }
  };

  const send = async (text?: string) => {
    const message = text || input;
    if (!message.trim()) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: message, timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      const result = await sendAgentMessage({
        message: userMsg.content,
        threadId,
      });

      setThreadId(result.thread_id);

      const response: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.reply,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, response]);
      window.dispatchEvent(new Event('booking-data-updated'));
    } catch (error) {
      const fallbackText =
        error instanceof Error
          ? `I could not reach the booking backend. ${error.message}`
          : 'I could not reach the booking backend.';

      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `${fallbackText}\n\nPlease ensure the Python API is running on http://127.0.0.1:8000.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`glass-button rounded-full p-2 h-fit shrink-0 ${msg.role === 'assistant' ? 'text-primary' : 'text-accent'}`}>
                {msg.role === 'assistant' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>
              <div className={`glass-card p-4 max-w-[80%] ${msg.role === 'user' ? 'rounded-2xl rounded-tr-md' : 'rounded-2xl rounded-tl-md'}`}>
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground text-sm leading-relaxed">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
                <span className="text-[10px] text-muted-foreground mt-2 block">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'assistant' && msg.id !== '1' && (
                  <div className="flex items-center gap-1 mt-2 pt-2 border-t border-border/20">
                    <button
                      onClick={() => setFeedbacks(prev => ({ ...prev, [msg.id]: 'up' }))}
                      className={`glass-button rounded-lg p-1.5 transition-all ${feedbacks[msg.id] === 'up' ? 'text-primary ring-1 ring-primary/30' : 'text-muted-foreground hover:text-primary'}`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setFeedbacks(prev => ({ ...prev, [msg.id]: 'down' }))}
                      className={`glass-button rounded-lg p-1.5 transition-all ${feedbacks[msg.id] === 'down' ? 'text-destructive ring-1 ring-destructive/30' : 'text-muted-foreground hover:text-destructive'}`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.content);
                        setCopied(msg.id);
                        setTimeout(() => setCopied(null), 1500);
                      }}
                      className="glass-button rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-all ml-auto"
                    >
                      {copied === msg.id ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="glass-button rounded-full p-2 text-primary"><Bot className="h-4 w-4" /></div>
            <div className="glass-card p-4 rounded-2xl rounded-tl-md">
              <div className="flex gap-1.5">
                {[0, 1, 2].map(i => (
                  <motion.div key={i} className="w-2 h-2 rounded-full bg-primary/60"
                    animate={{ y: [0, -6, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick action chips */}
      {messages.length <= 1 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-4 pb-2 flex flex-wrap gap-2"
        >
          {quickActions.map((action) => (
            <button
              key={action}
              onClick={() => send(action)}
              className="glass-button rounded-full px-3 py-1.5 text-xs text-foreground flex items-center gap-1.5 hover:text-primary"
            >
              <Sparkles className="h-3 w-3 text-primary" />
              {action}
            </button>
          ))}
        </motion.div>
      )}

      <div className="p-4 border-t border-border/50">
        <div className="glass-input flex items-center gap-2 rounded-2xl px-4 py-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            placeholder="Type a message... e.g. 'Book a meeting tomorrow at 3 PM'"
            className="flex-1 bg-transparent outline-none text-sm text-foreground placeholder:text-muted-foreground"
          />
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={() => send()}
            disabled={!input.trim()}
            className="glass-button rounded-full p-2.5 text-primary disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={toggleVoiceInput}
            disabled={!isMicSupported}
            className="glass-button rounded-full p-2.5 text-muted-foreground hover:text-accent"
            title={isMicSupported ? (isListening ? 'Stop voice input' : 'Start voice input') : 'Voice input not supported in this browser'}
          >
            <Mic className={`h-4 w-4 ${isListening ? 'text-primary' : ''}`} />
          </motion.button>
        </div>
        {isListening && (
          <p className="text-[11px] text-primary mt-2">Listening... tap mic again to stop.</p>
        )}
      </div>
    </div>
  );
};
