'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Search, User, MessageSquare, Clock, Shield, Check, CheckCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getChatList, getMessages, sendMessage, markMessagesAsRead } from '@/app/actions/messages';

interface Contact {
  id: string;
  name: string;
  email: string;
  role: string;
  lastMessage: {
    content: string;
    createdAt: Date | string | null;
    senderId: string;
  } | null;
  unreadCount: number;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  isRead: boolean | null;
  createdAt: Date | string | null;
}

interface ChatSystemProps {
  currentUserId: string;
  currentUserRole: string;
}

export function ChatSystem({ currentUserId, currentUserRole }: ChatSystemProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContact, setActiveContact] = useState<Contact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const preserveScrollRef = useRef(false);
  const previousScrollHeightRef = useRef(0);
  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  // Load Contacts list initially
  const loadContacts = useCallback(async (showLoading = true, query = searchQuery) => {
    if (showLoading) setLoadingContacts(true);
    const res = await getChatList(query);
    if (res.success && res.data) {
      setContacts(res.data as Contact[]);

      // Update active contact details if already selected
      if (activeContact) {
        const updated = (res.data as Contact[]).find((c) => c.id === activeContact.id);
        if (updated) setActiveContact(updated);
      }
    }
    if (showLoading) setLoadingContacts(false);
  }, [activeContact, searchQuery]);

  useEffect(() => {
    loadContacts();

    // Refresh contacts every 8 seconds
    const interval = setInterval(() => {
      loadContacts(false, searchQuery);
    }, 8000);

    return () => clearInterval(interval);
  }, [loadContacts, searchQuery]);

  // Fetch messages for selected contact
  const loadMessages = useCallback(async (contactId: string, silent = false) => {
    if (!silent) setLoadingMessages(true);
    const res = await getMessages(contactId);
    if (res.success && res.data) {
      const retrievedMessages = res.data as Message[];
      setMessages(retrievedMessages);
      setHasMoreMessages(Boolean(res.hasMore));

      // Mark only incoming messages actually retrieved in this page as read.
      const unreadIds = retrievedMessages
        .filter((message) => message.senderId === contactId && message.receiverId === currentUserId && !message.isRead)
        .map((message) => message.id);
      if (unreadIds.length > 0) await markMessagesAsRead(contactId, unreadIds);
      await loadContacts(false);
    }
    if (!silent) setLoadingMessages(false);
  }, [loadContacts, currentUserId]);

  const loadOlderMessages = useCallback(async () => {
    if (!activeContact || !hasMoreMessages || loadingOlderMessages || messages.length === 0) return;
    const oldestMessage = messages[0];
    const container = messagesContainerRef.current;
    previousScrollHeightRef.current = container?.scrollHeight ?? 0;
    setLoadingOlderMessages(true);

    const res = await getMessages(activeContact.id, oldestMessage.id);
    if (res.success && res.data) {
      const olderMessages = res.data as Message[];
      preserveScrollRef.current = true;
      setMessages((current) => [...olderMessages, ...current]);
      setHasMoreMessages(Boolean(res.hasMore));

      const unreadIds = olderMessages
        .filter((message) => message.senderId === activeContact.id && message.receiverId === currentUserId && !message.isRead)
        .map((message) => message.id);
      if (unreadIds.length > 0) await markMessagesAsRead(activeContact.id, unreadIds);
      await loadContacts(false);
    }
    setLoadingOlderMessages(false);
  }, [activeContact, currentUserId, hasMoreMessages, loadingOlderMessages, messages, loadContacts]);

  // Poll for new messages if chat is open
  useEffect(() => {
    if (pollingInterval.current) clearInterval(pollingInterval.current);

    const activeContactId = activeContact?.id;

    if (activeContactId) {
      loadMessages(activeContactId);
      
      // Poll messages every 4 seconds for a fast, responsive chat feel
      pollingInterval.current = setInterval(() => {
        loadMessages(activeContactId, true);
      }, 4000);
    } else {
      setMessages([]);
    }

    return () => {
      if (pollingInterval.current) clearInterval(pollingInterval.current);
    };
  }, [activeContact, loadMessages]);

  // Scroll to bottom of chat when messages change
  useEffect(() => {
    if (preserveScrollRef.current && messagesContainerRef.current) {
      const container = messagesContainerRef.current;
      container.scrollTop += container.scrollHeight - previousScrollHeightRef.current;
      preserveScrollRef.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContact || !newMessage.trim() || isSending) return;

    const text = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    // Optimistic message append
    const tempId = Math.random().toString();
    const optimisticMsg: Message = {
      id: tempId,
      senderId: currentUserId,
      receiverId: activeContact.id,
      content: text,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);

    const res = await sendMessage(activeContact.id, text);
    if (res.success && res.data) {
      // Replace optimistic message with actual data from backend
      setMessages((prev) => prev.map((m) => (m.id === tempId ? (res.data as Message) : m)));
      await loadContacts(false);
    } else {
      // Revert optimistic insert on error
      setMessages(prev => prev.filter(m => m.id !== tempId));
      alert(res.error || 'No se pudo enviar el mensaje');
    }
    setIsSending(false);
  };

  const filteredContacts = contacts;

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[500px] border border-white/10 rounded-2xl overflow-hidden glass shadow-2xl">
      {/* ── Left Sidebar (Contacts List) ── */}
      <div className="w-80 border-r border-white/10 flex flex-col bg-slate-950/40">
        <div className="p-4 border-b border-white/5 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-500" />
            Centro de Mensajes
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Buscar chat..."
              value={searchQuery}
              onChange={(e) => {
                const query = e.target.value;
                setSearchQuery(query);
                loadContacts(false, query);
              }}
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700/50 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
          {loadingContacts ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              <span className="text-xs font-medium">Cargando chats...</span>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No se encontraron contactos disponibles.
            </div>
          ) : (
            filteredContacts.map(contact => {
              const isActive = activeContact?.id === contact.id;
              return (
                <button
                  key={contact.id}
                  onClick={() => setActiveContact(contact)}
                  className={cn(
                    "w-full text-left p-4 flex gap-3 hover:bg-white/5 transition-all relative border-l-4",
                    isActive ? "bg-blue-600/10 border-l-blue-500" : "border-l-transparent",
                    contact.unreadCount > 0 && "bg-emerald-500/5"
                  )}
                >
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 text-slate-300">
                      <User size={18} />
                    </div>
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border border-slate-950 animate-pulse" />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-sm text-white truncate flex items-center gap-1.5">
                        {contact.name}
                        {contact.role === 'admin' && (
                          <span title="Administrador">
                            <Shield size={12} className="text-blue-400" />
                          </span>
                        )}
                      </span>
                      {contact.lastMessage?.createdAt && (
                        <span className="text-[10px] text-slate-500">
                          {new Date(contact.lastMessage.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    
                    <p className={cn(
                      "text-xs truncate",
                      contact.unreadCount > 0 ? "text-slate-200 font-semibold" : "text-slate-400"
                    )}>
                      {contact.lastMessage ? contact.lastMessage.content : "Sin mensajes aún"}
                    </p>
                  </div>

                  {contact.unreadCount > 0 && (
                    <span className="absolute top-4 right-4 bg-emerald-500 text-[10px] font-bold text-white px-2 py-0.5 rounded-full">
                      {contact.unreadCount}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel (Chat Conversation) ── */}
      <div className="flex-1 flex flex-col bg-slate-950/20">
        {activeContact ? (
          <>
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-950/40">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10 text-slate-300">
                    <User size={18} />
                  </div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 border border-slate-950 animate-pulse" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                    {activeContact.name}
                    {activeContact.role === 'admin' && (
                      <span title="Administrador">
                        <Shield size={12} className="text-blue-400" />
                      </span>
                    )}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-medium">Activo ahora</span>
                </div>
              </div>
            </div>

            {/* Message Area */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
              {hasMoreMessages && !loadingMessages && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={loadOlderMessages}
                    disabled={loadingOlderMessages}
                    className="px-4 py-2 text-xs font-semibold text-blue-300 hover:text-white disabled:opacity-50"
                  >
                    {loadingOlderMessages ? 'Cargando mensajes...' : 'Cargar mensajes anteriores'}
                  </button>
                </div>
              )}
              {loadingMessages ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <span className="text-xs">Cargando conversación...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                  <MessageSquare className="w-12 h-12 text-slate-700" />
                  <span className="text-sm">Envía un mensaje para comenzar la conversación.</span>
                </div>
              ) : (
                messages.map((m) => {
                  const isMe = m.senderId === currentUserId;
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "flex flex-col max-w-[70%]",
                        isMe ? "ml-auto items-end" : "mr-auto items-start"
                      )}
                    >
                      <div
                        className={cn(
                          "px-4 py-2.5 rounded-2xl text-sm shadow-md",
                          isMe
                            ? "bg-blue-600 text-white rounded-br-none"
                            : "bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/50"
                        )}
                      >
                        <p className="leading-relaxed break-words whitespace-pre-wrap">{m.content}</p>
                      </div>
                      
                      <div className="flex items-center gap-1 mt-1 text-[9px] text-slate-500">
                        {m.createdAt && (
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                        {isMe && (
                          m.isRead ? <CheckCheck size={10} className="text-blue-400" /> : <Check size={10} className="text-slate-500" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSendMessage} className="p-4 border-t border-white/10 bg-slate-950/40 flex gap-3">
              <input
                type="text"
                placeholder="Escribe tu mensaje aquí..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                disabled={isSending}
                className="flex-1 bg-slate-950 border border-slate-700/50 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              <button
                type="submit"
                disabled={!newMessage.trim() || isSending}
                className="bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/40 text-white px-4 rounded-xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 disabled:scale-100"
              >
                {isSending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-4 p-8">
            <div className="p-4 rounded-full bg-slate-800/50 border border-white/5">
              <MessageSquare className="w-10 h-10 text-blue-500/80" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="font-bold text-white text-base">Conversación Activa</h3>
              <p className="text-xs text-slate-400 max-w-xs">
                Selecciona a un contacto de la barra lateral para empezar a chatear en tiempo real.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
